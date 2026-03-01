const fs = require('fs');
const path = require('path');
const multer = require('multer');

let cloudinary = null;
try {
    ({ v2: cloudinary } = require('cloudinary'));
} catch {
    cloudinary = null;
}

function createDiskStorage(destination) {
    return multer.diskStorage({
        destination: (_, __, cb) => cb(null, destination),
        filename: (_, file, cb) => {
            const ext = (path.extname(file.originalname || '') || '.bin').slice(0, 12);
            const random = Math.random().toString(36).slice(2, 10);
            cb(null, `${Date.now()}-${random}${ext}`);
        },
    });
}

function buildCloudinaryFolder(prefix, folder) {
    return [prefix, folder]
        .map((value) => String(value || '').trim().replace(/^\/+|\/+$/g, ''))
        .filter(Boolean)
        .join('/');
}

function parseCloudinaryAsset(url) {
    const value = String(url || '').trim();
    if (!value) return null;

    try {
        const parsed = new URL(value);
        if (parsed.hostname !== 'res.cloudinary.com') {
            return null;
        }

        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length < 4) {
            return null;
        }

        const resourceType = parts[1];
        const uploadIndex = parts.indexOf('upload');
        if (uploadIndex < 0) {
            return null;
        }

        const afterUpload = parts.slice(uploadIndex + 1);
        if (!afterUpload.length) {
            return null;
        }

        const versionIndex = afterUpload.findIndex((item) => /^v\d+$/.test(item));
        const publicParts = versionIndex >= 0 ? afterUpload.slice(versionIndex + 1) : afterUpload;
        if (!publicParts.length) {
            return null;
        }

        const last = publicParts[publicParts.length - 1].replace(/\.[^.]+$/, '');
        const publicId = [...publicParts.slice(0, -1), last].join('/');
        if (!publicId) {
            return null;
        }

        return {
            resourceType,
            publicId,
        };
    } catch {
        return null;
    }
}

function createMediaStorage({
    uploadsRoot,
    cloudName = '',
    apiKey = '',
    apiSecret = '',
    folderPrefix = 'mirx',
}) {
    const enabled = Boolean(cloudinary && cloudName && apiKey && apiSecret);

    if (enabled) {
        cloudinary.config({
            secure: true,
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret,
        });
    }

    function createUpload({ destination, fileSizeLimitMb = 8, allowedMimePrefixes = ['image/'] } = {}) {
        return multer({
            storage: enabled ? multer.memoryStorage() : createDiskStorage(destination),
            limits: {
                fileSize: fileSizeLimitMb * 1024 * 1024,
            },
            fileFilter: (_, file, cb) => {
                const isAllowed = allowedMimePrefixes.some((prefix) => file.mimetype && file.mimetype.startsWith(prefix));
                if (!isAllowed) {
                    cb(new Error('Недопустимый тип файла.'));
                    return;
                }
                cb(null, true);
            },
        });
    }

    function localPublicUrl(localFolder, file) {
        const folder = String(localFolder || '').trim().replace(/^\/+|\/+$/g, '');
        return `/uploads/${folder}/${file.filename}`.replace(/\/+/g, '/');
    }

    async function uploadToCloudinary(file, { cloudFolder, resourceType = 'image' } = {}) {
        if (!enabled) {
            throw new Error('Cloudinary is not configured.');
        }
        if (!file?.buffer) {
            throw new Error('Uploaded file buffer is missing.');
        }

        const folder = buildCloudinaryFolder(folderPrefix, cloudFolder);

        return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder,
                    resource_type: resourceType,
                    use_filename: true,
                    unique_filename: true,
                    overwrite: false,
                },
                (error, result) => {
                    if (error || !result?.secure_url) {
                        reject(error || new Error('Cloudinary upload failed.'));
                        return;
                    }
                    resolve(result.secure_url);
                }
            );

            stream.end(file.buffer);
        });
    }

    async function storeFile(file, { localFolder, cloudFolder, resourceType = 'image' } = {}) {
        if (!file) {
            throw new Error('Uploaded file is missing.');
        }

        if (enabled) {
            return uploadToCloudinary(file, {
                cloudFolder,
                resourceType,
            });
        }

        return localPublicUrl(localFolder, file);
    }

    async function removeFile(value) {
        const input = String(value || '').trim();
        if (!input) return;

        const cloudAsset = parseCloudinaryAsset(input);
        if (enabled && cloudAsset) {
            try {
                await cloudinary.uploader.destroy(cloudAsset.publicId, {
                    resource_type: cloudAsset.resourceType,
                    invalidate: true,
                });
            } catch (error) {
                console.error('[media-storage] failed to remove cloud asset', cloudAsset.publicId, error);
            }
            return;
        }

        if (!input.startsWith('/uploads/')) return;
        const relativePath = input.replace(/^\/uploads\/?/, '').replace(/\//g, path.sep);
        const diskPath = path.join(uploadsRoot, relativePath);
        try {
            await fs.promises.unlink(diskPath);
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.error('[media-storage] failed to remove local asset', diskPath, error);
            }
        }
    }

    return {
        enabled,
        provider: enabled ? 'cloudinary' : 'local',
        createUpload,
        storeFile,
        removeFile,
    };
}

module.exports = {
    createMediaStorage,
};

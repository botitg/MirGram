const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

let cloudinary = null;
try {
    ({ v2: cloudinary } = require('cloudinary'));
} catch {
    cloudinary = null;
}

let createSupabaseClient = null;
try {
    ({ createClient: createSupabaseClient } = require('@supabase/supabase-js'));
} catch {
    createSupabaseClient = null;
}

function sanitizeSegment(value) {
    return String(value || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '');
}

function joinRemotePath(...segments) {
    return segments
        .map((segment) => sanitizeSegment(segment))
        .filter(Boolean)
        .join('/');
}

function buildRandomFileName(file) {
    const ext = (path.extname(file?.originalname || '') || '.bin').slice(0, 12);
    const random = crypto.randomBytes(8).toString('hex');
    return `${Date.now()}-${random}${ext}`;
}

function createDiskStorage(destination) {
    return multer.diskStorage({
        destination: (_, __, cb) => cb(null, destination),
        filename: (_, file, cb) => cb(null, buildRandomFileName(file)),
    });
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

function parseSupabaseAsset(url, supabaseUrl = '') {
    const value = String(url || '').trim();
    if (!value) return null;

    try {
        const parsed = new URL(value);
        const configuredOrigin = supabaseUrl ? new URL(supabaseUrl).origin : '';
        if (configuredOrigin && parsed.origin !== configuredOrigin) {
            return null;
        }

        const parts = parsed.pathname.split('/').filter(Boolean);
        const objectIndex = parts.indexOf('object');
        const publicIndex = parts.indexOf('public');
        if (objectIndex < 0 || publicIndex < 0 || publicIndex <= objectIndex) {
            return null;
        }

        const bucket = parts[publicIndex + 1];
        const objectPath = decodeURIComponent(parts.slice(publicIndex + 2).join('/'));
        if (!bucket || !objectPath) {
            return null;
        }

        return {
            bucket,
            objectPath,
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
    supabaseUrl = '',
    supabaseServiceRoleKey = '',
    supabaseStorageBucket = 'mirx-media',
}) {
    const cloudinaryConfigured = Boolean(cloudinary && cloudName && apiKey && apiSecret);
    if (cloudinaryConfigured) {
        cloudinary.config({
            secure: true,
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret,
        });
    }

    const supabaseConfigured = Boolean(
        createSupabaseClient
        && supabaseUrl
        && supabaseServiceRoleKey
        && supabaseStorageBucket
    );
    const supabase = supabaseConfigured
        ? createSupabaseClient(supabaseUrl, supabaseServiceRoleKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            },
        })
        : null;

    const provider = supabaseConfigured
        ? 'supabase'
        : (cloudinaryConfigured ? 'cloudinary' : 'local');

    function createUpload({ destination, fileSizeLimitMb = 8, allowedMimePrefixes = ['image/'] } = {}) {
        return multer({
            storage: provider === 'local' ? createDiskStorage(destination) : multer.memoryStorage(),
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
        const folder = sanitizeSegment(localFolder);
        return `/uploads/${folder}/${file.filename}`.replace(/\/+/g, '/');
    }

    async function uploadToCloudinary(file, { cloudFolder, resourceType = 'image' } = {}) {
        if (!cloudinaryConfigured) {
            throw new Error('Cloudinary is not configured.');
        }
        if (!file?.buffer) {
            throw new Error('Uploaded file buffer is missing.');
        }

        const folder = joinRemotePath(folderPrefix, cloudFolder);

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

    async function uploadToSupabase(file, { localFolder, cloudFolder } = {}) {
        if (!supabaseConfigured || !supabase) {
            throw new Error('Supabase Storage is not configured.');
        }
        if (!file?.buffer) {
            throw new Error('Uploaded file buffer is missing.');
        }

        const folder = joinRemotePath(folderPrefix, cloudFolder || localFolder);
        const objectPath = joinRemotePath(folder, buildRandomFileName(file));
        const bucket = supabaseStorageBucket;

        const { error } = await supabase.storage.from(bucket).upload(objectPath, file.buffer, {
            contentType: file.mimetype || undefined,
            upsert: false,
            cacheControl: '31536000',
        });
        if (error) {
            throw error;
        }

        const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
        if (!data?.publicUrl) {
            throw new Error('Supabase public URL was not generated.');
        }

        return data.publicUrl;
    }

    async function storeFile(file, { localFolder, cloudFolder, resourceType = 'image' } = {}) {
        if (!file) {
            throw new Error('Uploaded file is missing.');
        }

        if (provider === 'supabase') {
            return uploadToSupabase(file, {
                localFolder,
                cloudFolder,
                resourceType,
            });
        }

        if (provider === 'cloudinary') {
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

        const supabaseAsset = parseSupabaseAsset(input, supabaseUrl);
        if (supabaseConfigured && supabaseAsset) {
            try {
                await supabase.storage.from(supabaseAsset.bucket).remove([supabaseAsset.objectPath]);
            } catch (error) {
                console.error('[media-storage] failed to remove supabase asset', supabaseAsset.objectPath, error);
            }
            return;
        }

        const cloudAsset = parseCloudinaryAsset(input);
        if (cloudinaryConfigured && cloudAsset) {
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
        enabled: provider !== 'local',
        provider,
        createUpload,
        storeFile,
        removeFile,
    };
}

module.exports = {
    createMediaStorage,
};

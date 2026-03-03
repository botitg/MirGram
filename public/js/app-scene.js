(() => {
    const canvas = document.getElementById("appSceneCanvas");
    const appScreen = document.getElementById("appScreen");
    const host = document.querySelector(".app-scene-layer");

    if (!canvas || !appScreen || !host || !window.THREE) {
        return;
    }

    const THREE = window.THREE;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06111c, 0.034);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 140);
    camera.position.set(0, 0.2, 11.8);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    const hemisphereLight = new THREE.HemisphereLight(0x9adfff, 0x04101b, 1.15);
    const blueLight = new THREE.PointLight(0x58c8ff, 20, 42, 2);
    const goldLight = new THREE.PointLight(0xf2ca78, 16, 36, 2);
    const rimLight = new THREE.PointLight(0x6f7dff, 12, 28, 2);
    blueLight.position.set(-5.4, 3.6, 6.8);
    goldLight.position.set(5.8, -2.6, 5.6);
    rimLight.position.set(0.4, 4.2, -3.6);
    scene.add(ambientLight, hemisphereLight, blueLight, goldLight, rimLight);

    const world = new THREE.Group();
    const cluster = new THREE.Group();
    world.add(cluster);
    scene.add(world);

    const disposableGeometries = [];
    const disposableMaterials = [];

    function trackGeometry(geometry) {
        disposableGeometries.push(geometry);
        return geometry;
    }

    function trackMaterial(material) {
        disposableMaterials.push(material);
        return material;
    }

    function makeGlassMaterial(color, emissive, opacity = 0.66) {
        return trackMaterial(new THREE.MeshPhysicalMaterial({
            color,
            emissive,
            emissiveIntensity: 0.8,
            roughness: 0.14,
            metalness: 0.72,
            transmission: 0.28,
            transparent: true,
            opacity,
            thickness: 1.8,
            ior: 1.28,
            clearcoat: 1,
            clearcoatRoughness: 0.16,
        }));
    }

    const core = new THREE.Mesh(
        trackGeometry(new THREE.IcosahedronGeometry(1.58, 7)),
        makeGlassMaterial(0x7dd6ff, 0x16384f, 0.92)
    );
    cluster.add(core);

    const shell = new THREE.Mesh(
        trackGeometry(new THREE.IcosahedronGeometry(2.35, 2)),
        trackMaterial(new THREE.MeshBasicMaterial({
            color: 0xbce8ff,
            wireframe: true,
            transparent: true,
            opacity: 0.18,
        }))
    );
    cluster.add(shell);

    const crownRing = new THREE.Mesh(
        trackGeometry(new THREE.TorusGeometry(2.95, 0.08, 22, 180)),
        trackMaterial(new THREE.MeshStandardMaterial({
            color: 0xf2ca78,
            emissive: 0xd4a14a,
            emissiveIntensity: 0.9,
            roughness: 0.26,
            metalness: 0.78,
            transparent: true,
            opacity: 0.78,
        }))
    );
    crownRing.rotation.set(Math.PI / 2.45, 0.24, 0.12);
    cluster.add(crownRing);

    const equatorRing = new THREE.Mesh(
        trackGeometry(new THREE.TorusGeometry(2.1, 0.05, 18, 160)),
        trackMaterial(new THREE.MeshBasicMaterial({
            color: 0x8ddcff,
            transparent: true,
            opacity: 0.34,
        }))
    );
    equatorRing.rotation.set(0.42, 0.16, -0.2);
    cluster.add(equatorRing);

    const ribbonGroup = new THREE.Group();
    cluster.add(ribbonGroup);

    function createRibbon(points, color, opacity) {
        const curve = new THREE.CatmullRomCurve3(points);
        const mesh = new THREE.Mesh(
            trackGeometry(new THREE.TubeGeometry(curve, 220, 0.034, 10, true)),
            trackMaterial(new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity,
            }))
        );
        ribbonGroup.add(mesh);
        return mesh;
    }

    const ribbons = [
        createRibbon([
            new THREE.Vector3(-3.8, 0.4, -2.2),
            new THREE.Vector3(-1.8, 1.9, -1.1),
            new THREE.Vector3(0.2, 0.2, 0.4),
            new THREE.Vector3(2.4, -1.6, -1.2),
            new THREE.Vector3(4.1, -0.1, -2.4),
        ], 0x7fd8ff, 0.22),
        createRibbon([
            new THREE.Vector3(-4.2, -1.6, -3.4),
            new THREE.Vector3(-1.6, -0.8, -0.8),
            new THREE.Vector3(1.0, 1.3, -0.2),
            new THREE.Vector3(3.4, 1.0, -2.0),
            new THREE.Vector3(4.8, -1.2, -3.2),
        ], 0xf2ca78, 0.16),
    ];

    const slabGeometry = trackGeometry(new THREE.BoxGeometry(0.54, 2.46, 0.18));
    const slabs = [];
    for (let index = 0; index < 6; index += 1) {
        const angle = (index / 6) * Math.PI * 2;
        const material = makeGlassMaterial(index % 2 === 0 ? 0x6fd2ff : 0xf0c975, index % 2 === 0 ? 0x16354d : 0x47351b, 0.42);
        const slab = new THREE.Mesh(slabGeometry, material);
        slab.position.set(Math.cos(angle) * 4.6, (index % 2 === 0 ? -1 : 1) * 0.9, Math.sin(angle) * 1.8 - 2.6);
        slab.rotation.set(-0.12 + index * 0.04, angle + Math.PI / 2, 0.16 - index * 0.02);
        slab.scale.setScalar(0.82 + (index % 3) * 0.16);
        slab.userData = {
            angle,
            radius: 4.6 + (index % 2) * 0.45,
            baseY: slab.position.y,
        };
        slabs.push(slab);
        world.add(slab);
    }

    const shardGeometry = trackGeometry(new THREE.OctahedronGeometry(0.26, 0));
    const shards = [];
    for (let index = 0; index < 18; index += 1) {
        const mesh = new THREE.Mesh(
            shardGeometry,
            trackMaterial(new THREE.MeshStandardMaterial({
                color: index % 3 === 0 ? 0xf2ca78 : 0x7fd8ff,
                emissive: index % 3 === 0 ? 0x3b2a0f : 0x14344d,
                emissiveIntensity: 0.5,
                roughness: 0.3,
                metalness: 0.62,
                transparent: true,
                opacity: 0.82,
            }))
        );
        const radius = 3.1 + Math.random() * 4.8;
        const angle = Math.random() * Math.PI * 2;
        const height = (Math.random() - 0.5) * 4.8;
        mesh.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius - 2.8);
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        mesh.scale.setScalar(0.6 + Math.random() * 1.45);
        mesh.userData = {
            angle,
            radius,
            height,
            speed: 0.18 + Math.random() * 0.36,
            drift: Math.random() * Math.PI * 2,
        };
        shards.push(mesh);
        world.add(mesh);
    }

    const satelliteGroup = new THREE.Group();
    cluster.add(satelliteGroup);
    const satellites = [];
    for (let index = 0; index < 4; index += 1) {
        const satellite = new THREE.Mesh(
            trackGeometry(new THREE.SphereGeometry(0.18 + index * 0.03, 20, 20)),
            trackMaterial(new THREE.MeshBasicMaterial({
                color: index % 2 === 0 ? 0x93e4ff : 0xf2ca78,
                transparent: true,
                opacity: 0.76,
            }))
        );
        satellite.userData = {
            angle: (index / 4) * Math.PI * 2,
            radius: 2.3 + index * 0.42,
            offset: index * 0.7,
        };
        satellites.push(satellite);
        satelliteGroup.add(satellite);
    }

    const pointsCount = 1800;
    const positions = new Float32Array(pointsCount * 3);
    const colors = new Float32Array(pointsCount * 3);
    const colorA = new THREE.Color(0x7fd8ff);
    const colorB = new THREE.Color(0xf2ca78);

    for (let index = 0; index < pointsCount; index += 1) {
        const radius = 4.8 + Math.random() * 6.4;
        const theta = Math.random() * Math.PI * 2;
        const y = (Math.random() - 0.5) * 9.5;
        const offset = index * 3;
        positions[offset] = Math.cos(theta) * radius;
        positions[offset + 1] = y;
        positions[offset + 2] = Math.sin(theta) * radius - 5.2;

        const color = colorA.clone().lerp(colorB, Math.random() * 0.34);
        colors[offset] = color.r;
        colors[offset + 1] = color.g;
        colors[offset + 2] = color.b;
    }

    const pointsGeometry = trackGeometry(new THREE.BufferGeometry());
    pointsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointsGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const points = new THREE.Points(
        pointsGeometry,
        trackMaterial(new THREE.PointsMaterial({
            size: 0.052,
            transparent: true,
            opacity: 0.58,
            vertexColors: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }))
    );
    scene.add(points);

    const pointer = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    const cameraTarget = new THREE.Vector3(0, 0.1, -1.2);

    function onPointerMove(event) {
        const bounds = host.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        target.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        target.y = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
    }

    function onPointerLeave() {
        target.x = 0;
        target.y = 0;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerleave", onPointerLeave);

    function resize() {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.position.z = width <= 840 ? 13.2 : 11.8;
        camera.updateProjectionMatrix();
    }

    const resizeObserver = typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : null;

    if (resizeObserver) {
        resizeObserver.observe(host);
    } else {
        window.addEventListener("resize", resize);
    }

    resize();

    let rafId = 0;
    let lastTime = performance.now();

    function animate(time) {
        rafId = window.requestAnimationFrame(animate);

        const elapsed = time * 0.001;
        const delta = Math.min((time - lastTime) / 1000, 0.032);
        lastTime = time;

        pointer.x += (target.x - pointer.x) * 0.032;
        pointer.y += (target.y - pointer.y) * 0.032;

        const visible = !appScreen.classList.contains("hidden");
        const motion = prefersReducedMotion ? 0.18 : 1;
        const factor = visible ? 1 : 0.08;
        const spin = delta * motion * factor;

        cluster.rotation.y += spin * 0.42;
        cluster.rotation.x += spin * 0.08;
        core.rotation.y += spin * 1.1;
        core.rotation.x -= spin * 0.54;
        shell.rotation.y -= spin * 0.32;
        crownRing.rotation.z += spin * 0.68;
        crownRing.rotation.y += spin * 0.18;
        equatorRing.rotation.x -= spin * 0.38;
        points.rotation.y += spin * 0.08;
        points.rotation.x -= spin * 0.04;
        ribbonGroup.rotation.y -= spin * 0.24;

        cluster.position.x += ((pointer.x * 0.64) - cluster.position.x) * 0.035;
        cluster.position.y += (((-pointer.y * 0.34) + Math.sin(elapsed * 0.8) * 0.1) - cluster.position.y) * 0.035;
        world.rotation.z += ((pointer.x * 0.06) - world.rotation.z) * 0.028;
        world.rotation.x += (((-pointer.y * 0.04)) - world.rotation.x) * 0.028;

        slabs.forEach((slab, index) => {
            const angle = slab.userData.angle + elapsed * (0.06 + index * 0.004) * factor;
            slab.position.x = Math.cos(angle) * slab.userData.radius;
            slab.position.z = Math.sin(angle) * (1.8 + (index % 2) * 0.2) - 2.8;
            slab.position.y = slab.userData.baseY + Math.sin(elapsed * 1.2 + index) * 0.18 * motion;
            slab.rotation.y += spin * (0.26 + index * 0.02);
        });

        shards.forEach((shard, index) => {
            const orbit = shard.userData.angle + elapsed * shard.userData.speed * factor;
            shard.position.x = Math.cos(orbit) * shard.userData.radius;
            shard.position.z = Math.sin(orbit) * shard.userData.radius - 3.2;
            shard.position.y = shard.userData.height + Math.sin(elapsed * 1.4 + shard.userData.drift) * 0.22 * motion;
            shard.rotation.x += spin * (0.3 + index * 0.003);
            shard.rotation.y -= spin * (0.24 + index * 0.004);
        });

        satellites.forEach((satellite, index) => {
            const orbit = satellite.userData.angle + elapsed * (0.8 + index * 0.14) * factor;
            satellite.position.set(
                Math.cos(orbit) * satellite.userData.radius,
                Math.sin(elapsed * 1.2 + satellite.userData.offset) * 0.42,
                Math.sin(orbit) * satellite.userData.radius * 0.62
            );
        });

        ribbons[0].rotation.z = Math.sin(elapsed * 0.5) * 0.16;
        ribbons[1].rotation.x = Math.cos(elapsed * 0.42) * 0.14;

        camera.position.x += (((pointer.x * 1.1) + Math.sin(elapsed * 0.22) * 0.26) - camera.position.x) * 0.03;
        camera.position.y += (((-pointer.y * 0.54) + Math.cos(elapsed * 0.24) * 0.18) - camera.position.y) * 0.03;
        camera.lookAt(cameraTarget);

        renderer.render(scene, camera);
    }

    animate(lastTime);

    window.addEventListener("beforeunload", () => {
        window.cancelAnimationFrame(rafId);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerleave", onPointerLeave);
        resizeObserver?.disconnect();
        renderer.dispose();
        disposableGeometries.forEach((geometry) => geometry.dispose());
        disposableMaterials.forEach((material) => material.dispose());
    });
})();

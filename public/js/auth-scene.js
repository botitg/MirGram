(() => {
    const canvas = document.getElementById("authSceneCanvas");
    const authScreen = document.getElementById("authScreen");
    const frame = document.querySelector(".auth-scene-frame");

    if (!canvas || !authScreen || !frame || !window.THREE) {
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.85));
    if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07121d, 0.072);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.1, 10.2);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.66);
    const hemisphereLight = new THREE.HemisphereLight(0x9fe4ff, 0x05111c, 1.2);
    const keyLight = new THREE.PointLight(0x7fd4ff, 20, 30, 2);
    const rimLight = new THREE.PointLight(0xf2ca78, 14, 26, 2);
    const fillLight = new THREE.PointLight(0x6b84ff, 9, 22, 2);
    keyLight.position.set(3.8, 2.6, 5.8);
    rimLight.position.set(-4.4, -2.8, 4.4);
    fillLight.position.set(0.2, 3.6, -3.6);
    scene.add(ambientLight, hemisphereLight, keyLight, rimLight, fillLight);

    const root = new THREE.Group();
    scene.add(root);

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

    function makeGlassMaterial(color, emissive, opacity = 0.88) {
        return trackMaterial(new THREE.MeshPhysicalMaterial({
            color,
            emissive,
            emissiveIntensity: 0.92,
            roughness: 0.14,
            metalness: 0.78,
            transmission: 0.26,
            transparent: true,
            opacity,
            thickness: 2.1,
            ior: 1.24,
            clearcoat: 1,
            clearcoatRoughness: 0.16,
        }));
    }

    const core = new THREE.Mesh(
        trackGeometry(new THREE.IcosahedronGeometry(1.48, 8)),
        makeGlassMaterial(0x6fd2ff, 0x18425f)
    );
    root.add(core);

    const innerCore = new THREE.Mesh(
        trackGeometry(new THREE.OctahedronGeometry(0.74, 1)),
        makeGlassMaterial(0xf2ca78, 0x6a4a16, 0.74)
    );
    root.add(innerCore);

    const halo = new THREE.Mesh(
        trackGeometry(new THREE.TorusGeometry(2.7, 0.09, 24, 200)),
        trackMaterial(new THREE.MeshStandardMaterial({
            color: 0xf2ca78,
            emissive: 0xcf9e44,
            emissiveIntensity: 1,
            roughness: 0.24,
            metalness: 0.82,
            transparent: true,
            opacity: 0.82,
        }))
    );
    halo.rotation.x = Math.PI / 2.85;
    root.add(halo);

    const wireSphere = new THREE.Mesh(
        trackGeometry(new THREE.IcosahedronGeometry(2.4, 2)),
        trackMaterial(new THREE.MeshBasicMaterial({
            color: 0x8fdcff,
            wireframe: true,
            transparent: true,
            opacity: 0.2,
        }))
    );
    root.add(wireSphere);

    const orbitRing = new THREE.Mesh(
        trackGeometry(new THREE.TorusGeometry(3.26, 0.04, 18, 220)),
        trackMaterial(new THREE.MeshBasicMaterial({
            color: 0xc4eeff,
            transparent: true,
            opacity: 0.28,
        }))
    );
    orbitRing.rotation.set(0.6, 0.32, 0.16);
    root.add(orbitRing);

    const ribbonGroup = new THREE.Group();
    root.add(ribbonGroup);

    function createRibbon(points, color, opacity) {
        const curve = new THREE.CatmullRomCurve3(points);
        const mesh = new THREE.Mesh(
            trackGeometry(new THREE.TubeGeometry(curve, 240, 0.036, 10, true)),
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
            new THREE.Vector3(-3.6, 0.4, -0.8),
            new THREE.Vector3(-1.8, 2.2, 0.5),
            new THREE.Vector3(0.4, 0.4, 1.2),
            new THREE.Vector3(2.8, -1.8, 0.3),
            new THREE.Vector3(4.0, -0.2, -1.1),
        ], 0x7fd8ff, 0.24),
        createRibbon([
            new THREE.Vector3(-4.2, -1.4, -1.6),
            new THREE.Vector3(-2.2, -0.6, 1.0),
            new THREE.Vector3(0.6, 1.8, -0.2),
            new THREE.Vector3(3.2, 1.0, -1.6),
            new THREE.Vector3(4.2, -1.6, -0.8),
        ], 0xf2ca78, 0.18),
    ];

    const shardGeometry = trackGeometry(new THREE.TetrahedronGeometry(0.22, 0));
    const shards = [];
    for (let index = 0; index < 20; index += 1) {
        const mesh = new THREE.Mesh(
            shardGeometry,
            trackMaterial(new THREE.MeshStandardMaterial({
                color: index % 4 === 0 ? 0xf2ca78 : 0x7dd6ff,
                emissive: index % 4 === 0 ? 0x563912 : 0x123a53,
                emissiveIntensity: 0.44,
                roughness: 0.26,
                metalness: 0.66,
                transparent: true,
                opacity: 0.8,
            }))
        );
        const radius = 2.8 + Math.random() * 3.4;
        const angle = Math.random() * Math.PI * 2;
        const height = (Math.random() - 0.5) * 4.6;
        mesh.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        mesh.scale.setScalar(0.6 + Math.random() * 1.5);
        mesh.userData = {
            angle,
            radius,
            height,
            speed: 0.2 + Math.random() * 0.5,
            offset: Math.random() * Math.PI * 2,
        };
        shards.push(mesh);
        scene.add(mesh);
    }

    const pillarGeometry = trackGeometry(new THREE.BoxGeometry(0.26, 1.9, 0.26));
    const pillars = [];
    for (let index = 0; index < 5; index += 1) {
        const pillar = new THREE.Mesh(
            pillarGeometry,
            makeGlassMaterial(index % 2 === 0 ? 0x70d2ff : 0xf2ca78, index % 2 === 0 ? 0x163e5a : 0x5d4014, 0.38)
        );
        const angle = (index / 5) * Math.PI * 2;
        pillar.position.set(Math.cos(angle) * 4.7, -1.2 + (index % 2) * 0.6, Math.sin(angle) * 1.8 - 1.6);
        pillar.rotation.set(0.16, angle, 0.1);
        pillar.userData = {
            angle,
            radius: 4.7,
            baseY: pillar.position.y,
        };
        pillars.push(pillar);
        scene.add(pillar);
    }

    const pointsCount = 1400;
    const positions = new Float32Array(pointsCount * 3);
    const colors = new Float32Array(pointsCount * 3);
    const cool = new THREE.Color(0x6fd2ff);
    const warm = new THREE.Color(0xf2ca78);

    for (let index = 0; index < pointsCount; index += 1) {
        const radius = 3.4 + Math.random() * 4.4;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        const offset = index * 3;

        positions[offset] = radius * Math.sin(phi) * Math.cos(theta);
        positions[offset + 1] = radius * Math.cos(phi) * 0.76;
        positions[offset + 2] = radius * Math.sin(phi) * Math.sin(theta);

        const color = cool.clone().lerp(warm, Math.random() * 0.4);
        colors[offset] = color.r;
        colors[offset + 1] = color.g;
        colors[offset + 2] = color.b;
    }

    const particleGeometry = trackGeometry(new THREE.BufferGeometry());
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const particles = new THREE.Points(
        particleGeometry,
        trackMaterial(new THREE.PointsMaterial({
            size: 0.04,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.78,
            vertexColors: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }))
    );
    scene.add(particles);

    const pointer = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    const lookTarget = new THREE.Vector3(0, 0, 0);
    const coolColor = new THREE.Color(0x6fd2ff);
    const warmColor = new THREE.Color(0xf2ca78);
    const warmBg = new THREE.Color(0x1a1621);
    const coolBg = new THREE.Color(0x07121d);

    function onPointerMove(event) {
        const bounds = frame.getBoundingClientRect();
        if (!bounds.width || !bounds.height) {
            return;
        }
        target.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        target.y = ((event.clientY - bounds.top) / bounds.height) * 2 - 1;
    }

    function onPointerLeave() {
        target.x = 0;
        target.y = 0;
    }

    frame.addEventListener("pointermove", onPointerMove);
    frame.addEventListener("pointerleave", onPointerLeave);

    function resize() {
        const width = frame.clientWidth;
        const height = frame.clientHeight;
        if (!width || !height) {
            return;
        }
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.position.z = width <= 640 ? 11.4 : 10.2;
        camera.updateProjectionMatrix();
    }

    const resizeObserver = typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : null;

    if (resizeObserver) {
        resizeObserver.observe(frame);
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

        pointer.x += (target.x - pointer.x) * 0.05;
        pointer.y += (target.y - pointer.y) * 0.05;

        const visible = !authScreen.classList.contains("hidden");
        const motion = prefersReducedMotion ? 0.18 : 1;
        const activeFactor = visible ? 1 : 0.12;
        const spin = delta * motion * activeFactor;
        const registerMode = authScreen.dataset.authTab === "register";
        const accentMix = registerMode ? 1 : 0;

        root.rotation.y += spin * 0.84;
        root.rotation.x += spin * 0.18;
        core.rotation.y += spin * 1.2;
        core.rotation.x -= spin * 0.54;
        innerCore.rotation.x += spin * 0.92;
        innerCore.rotation.y -= spin * 0.66;
        halo.rotation.z += spin * 1.12;
        wireSphere.rotation.x -= spin * 0.44;
        orbitRing.rotation.y -= spin * 0.72;
        orbitRing.rotation.z += spin * 0.18;
        particles.rotation.y += spin * 0.18;
        particles.rotation.x -= spin * 0.06;
        ribbonGroup.rotation.y -= spin * 0.18;

        root.position.x += ((pointer.x * 0.46) - root.position.x) * 0.05;
        root.position.y += (((-pointer.y * 0.32) + Math.sin(elapsed * 0.74) * 0.08) - root.position.y) * 0.05;

        ribbons[0].rotation.z = Math.sin(elapsed * 0.44) * 0.16;
        ribbons[1].rotation.x = Math.cos(elapsed * 0.38) * 0.14;

        shards.forEach((shard, index) => {
            const orbit = shard.userData.angle + elapsed * shard.userData.speed * activeFactor;
            shard.position.x = Math.cos(orbit) * shard.userData.radius;
            shard.position.z = Math.sin(orbit) * shard.userData.radius;
            shard.position.y = shard.userData.height + Math.sin(elapsed * 1.6 + shard.userData.offset) * 0.26 * motion;
            shard.rotation.x += spin * (0.3 + index * 0.004);
            shard.rotation.y -= spin * (0.24 + index * 0.004);
        });

        pillars.forEach((pillar, index) => {
            const orbit = pillar.userData.angle - elapsed * (0.08 + index * 0.01) * activeFactor;
            pillar.position.x = Math.cos(orbit) * pillar.userData.radius;
            pillar.position.z = Math.sin(orbit) * 1.9 - 1.8;
            pillar.position.y = pillar.userData.baseY + Math.cos(elapsed * 1.1 + index) * 0.14 * motion;
            pillar.rotation.y += spin * (0.2 + index * 0.03);
        });

        keyLight.color.lerp(registerMode ? warmColor : coolColor, 0.03);
        rimLight.color.lerp(registerMode ? coolColor : warmColor, 0.03);
        scene.fog.color.lerp(registerMode ? warmBg : coolBg, 0.02);

        camera.position.x += (((pointer.x * 0.7) + Math.sin(elapsed * 0.16) * 0.16) - camera.position.x) * 0.04;
        camera.position.y += (((-pointer.y * 0.36) + Math.cos(elapsed * 0.18) * 0.12) - camera.position.y) * 0.04;
        camera.lookAt(lookTarget);

        innerCore.scale.setScalar(1 + Math.sin(elapsed * 1.8) * 0.06 + accentMix * 0.02);

        renderer.render(scene, camera);
    }

    animate(lastTime);

    window.addEventListener("beforeunload", () => {
        window.cancelAnimationFrame(rafId);
        frame.removeEventListener("pointermove", onPointerMove);
        frame.removeEventListener("pointerleave", onPointerLeave);
        resizeObserver?.disconnect();
        renderer.dispose();
        disposableGeometries.forEach((geometry) => geometry.dispose());
        disposableMaterials.forEach((material) => material.dispose());
    });
})();

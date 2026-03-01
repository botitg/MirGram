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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07121d, 0.08);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 9.5);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    const keyLight = new THREE.PointLight(0x7fd4ff, 18, 24, 2);
    const rimLight = new THREE.PointLight(0xf2ca78, 12, 30, 2);
    keyLight.position.set(3.5, 2.4, 5.8);
    rimLight.position.set(-4.2, -2.6, 4.4);
    scene.add(ambientLight, keyLight, rimLight);

    const root = new THREE.Group();
    scene.add(root);

    const coreMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x67c8ff,
        emissive: 0x143f63,
        emissiveIntensity: 0.9,
        roughness: 0.16,
        metalness: 0.72,
        transmission: 0.22,
        transparent: true,
        opacity: 0.92,
        thickness: 1.8,
        ior: 1.24,
        clearcoat: 1,
        clearcoatRoughness: 0.18,
    });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, 8), coreMaterial);
    root.add(core);

    const halo = new THREE.Mesh(
        new THREE.TorusGeometry(2.65, 0.09, 24, 180),
        new THREE.MeshStandardMaterial({
            color: 0xf2ca78,
            emissive: 0xd2a857,
            emissiveIntensity: 1,
            roughness: 0.28,
            metalness: 0.74,
            transparent: true,
            opacity: 0.88,
        })
    );
    halo.rotation.x = Math.PI / 2.8;
    root.add(halo);

    const wireSphere = new THREE.Mesh(
        new THREE.IcosahedronGeometry(2.45, 2),
        new THREE.MeshBasicMaterial({
            color: 0x89d8ff,
            wireframe: true,
            transparent: true,
            opacity: 0.22,
        })
    );
    root.add(wireSphere);

    const outerRing = new THREE.Mesh(
        new THREE.TorusKnotGeometry(3.05, 0.045, 190, 20, 2, 7),
        new THREE.MeshBasicMaterial({
            color: 0xbde7ff,
            transparent: true,
            opacity: 0.3,
        })
    );
    outerRing.rotation.set(0.5, 0.3, 0.12);
    root.add(outerRing);

    const pointsCount = 1200;
    const positions = new Float32Array(pointsCount * 3);
    const colors = new Float32Array(pointsCount * 3);
    const colorA = new THREE.Color(0x67c8ff);
    const colorB = new THREE.Color(0xf2ca78);

    for (let index = 0; index < pointsCount; index += 1) {
        const radius = 3.5 + Math.random() * 3.7;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        const offset = index * 3;

        positions[offset] = radius * Math.sin(phi) * Math.cos(theta);
        positions[offset + 1] = radius * Math.cos(phi) * 0.7;
        positions[offset + 2] = radius * Math.sin(phi) * Math.sin(theta);

        const blended = colorA.clone().lerp(colorB, Math.random() * 0.45);
        colors[offset] = blended.r;
        colors[offset + 1] = blended.g;
        colors[offset + 2] = blended.b;
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const particles = new THREE.Points(
        particleGeometry,
        new THREE.PointsMaterial({
            size: 0.04,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.75,
            vertexColors: true,
            depthWrite: false,
        })
    );
    scene.add(particles);

    const pointer = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };

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

        const delta = Math.min((time - lastTime) / 1000, 0.032);
        lastTime = time;

        pointer.x += (target.x - pointer.x) * 0.05;
        pointer.y += (target.y - pointer.y) * 0.05;

        const idleFactor = prefersReducedMotion ? 0.18 : 1;
        const visible = !authScreen.classList.contains("hidden");
        const activeFactor = visible ? 1 : 0.16;
        const spin = delta * idleFactor * activeFactor;

        root.rotation.y += spin * 0.9;
        root.rotation.x += spin * 0.24;
        core.rotation.y += spin * 1.4;
        core.rotation.x -= spin * 0.7;
        halo.rotation.z += spin * 1.2;
        wireSphere.rotation.x -= spin * 0.5;
        outerRing.rotation.y -= spin * 0.8;
        particles.rotation.y += spin * 0.18;
        particles.rotation.x -= spin * 0.08;

        root.position.x += ((pointer.x * 0.42) - root.position.x) * 0.055;
        root.position.y += ((-pointer.y * 0.3) - root.position.y) * 0.055;
        camera.position.x += ((pointer.x * 0.65) - camera.position.x) * 0.04;
        camera.position.y += ((-pointer.y * 0.35) - camera.position.y) * 0.04;
        camera.lookAt(0, 0, 0);

        renderer.render(scene, camera);
    }

    animate(lastTime);

    window.addEventListener("beforeunload", () => {
        window.cancelAnimationFrame(rafId);
        frame.removeEventListener("pointermove", onPointerMove);
        frame.removeEventListener("pointerleave", onPointerLeave);
        resizeObserver?.disconnect();
        renderer.dispose();
        particleGeometry.dispose();
        core.geometry.dispose();
        core.material.dispose();
        halo.geometry.dispose();
        halo.material.dispose();
        wireSphere.geometry.dispose();
        wireSphere.material.dispose();
        outerRing.geometry.dispose();
        outerRing.material.dispose();
        particles.material.dispose();
    });
})();

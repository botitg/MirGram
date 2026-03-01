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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    if ("outputColorSpace" in renderer && THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 0, 11);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    const blueLight = new THREE.PointLight(0x51c2ff, 14, 30, 2);
    const goldLight = new THREE.PointLight(0xf2ca78, 10, 28, 2);
    blueLight.position.set(-3.5, 2.2, 5.5);
    goldLight.position.set(4.2, -1.4, 5.2);
    scene.add(ambientLight, blueLight, goldLight);

    const group = new THREE.Group();
    scene.add(group);

    const orb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.4, 4),
        new THREE.MeshPhysicalMaterial({
            color: 0x63c7ff,
            emissive: 0x14354e,
            emissiveIntensity: 0.8,
            roughness: 0.24,
            metalness: 0.6,
            transmission: 0.16,
            transparent: true,
            opacity: 0.28,
        })
    );
    orb.position.set(-2.8, 1.8, -1.6);
    group.add(orb);

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.4, 0.08, 18, 120),
        new THREE.MeshBasicMaterial({
            color: 0xf2ca78,
            transparent: true,
            opacity: 0.24,
        })
    );
    ring.position.set(3.2, -1.8, -2.1);
    ring.rotation.x = Math.PI / 2.6;
    ring.rotation.y = 0.3;
    group.add(ring);

    const knots = [];
    for (let i = 0; i < 2; i += 1) {
        const knot = new THREE.Mesh(
            new THREE.TorusKnotGeometry(0.82 + i * 0.28, 0.03, 140, 18, 2, 5),
            new THREE.MeshBasicMaterial({
                color: i === 0 ? 0x89d8ff : 0xd2b46a,
                transparent: true,
                opacity: i === 0 ? 0.2 : 0.12,
            })
        );
        knot.position.set(i === 0 ? -4.2 : 4.6, i === 0 ? -2.3 : 2.6, -3.2);
        knots.push(knot);
        group.add(knot);
    }

    const pointsCount = 900;
    const positions = new Float32Array(pointsCount * 3);
    const colors = new Float32Array(pointsCount * 3);
    const colorA = new THREE.Color(0x63c7ff);
    const colorB = new THREE.Color(0xf2ca78);

    for (let index = 0; index < pointsCount; index += 1) {
        const radius = 5 + Math.random() * 5;
        const theta = Math.random() * Math.PI * 2;
        const y = (Math.random() - 0.5) * 7;
        const offset = index * 3;

        positions[offset] = Math.cos(theta) * radius;
        positions[offset + 1] = y;
        positions[offset + 2] = Math.sin(theta) * radius - 3;

        const color = colorA.clone().lerp(colorB, Math.random() * 0.3);
        colors[offset] = color.r;
        colors[offset + 1] = color.g;
        colors[offset + 2] = color.b;
    }

    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointsGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const points = new THREE.Points(
        pointsGeometry,
        new THREE.PointsMaterial({
            size: 0.05,
            transparent: true,
            opacity: 0.62,
            vertexColors: true,
            depthWrite: false,
        })
    );
    scene.add(points);

    const pointer = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };

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

        const delta = Math.min((time - lastTime) / 1000, 0.032);
        lastTime = time;

        pointer.x += (target.x - pointer.x) * 0.03;
        pointer.y += (target.y - pointer.y) * 0.03;

        const visible = !appScreen.classList.contains("hidden");
        const motion = prefersReducedMotion ? 0.18 : 1;
        const factor = visible ? 1 : 0.08;
        const spin = delta * motion * factor;

        orb.rotation.x += spin * 0.3;
        orb.rotation.y += spin * 0.5;
        ring.rotation.z += spin * 0.28;
        knots[0].rotation.y -= spin * 0.36;
        knots[1].rotation.x += spin * 0.22;
        points.rotation.y += spin * 0.06;
        points.rotation.x -= spin * 0.03;

        group.position.x += ((pointer.x * 0.4) - group.position.x) * 0.03;
        group.position.y += ((-pointer.y * 0.25) - group.position.y) * 0.03;
        camera.lookAt(0, 0, 0);

        renderer.render(scene, camera);
    }

    animate(lastTime);

    window.addEventListener("beforeunload", () => {
        window.cancelAnimationFrame(rafId);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerleave", onPointerLeave);
        resizeObserver?.disconnect();
        renderer.dispose();
        orb.geometry.dispose();
        orb.material.dispose();
        ring.geometry.dispose();
        ring.material.dispose();
        for (const knot of knots) {
            knot.geometry.dispose();
            knot.material.dispose();
        }
        pointsGeometry.dispose();
        points.material.dispose();
    });
})();

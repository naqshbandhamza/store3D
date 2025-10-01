import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import nipplejs from "nipplejs";


const monkeyUrl = new URL("../../assets/glb/room3dd.glb", import.meta.url);
const studioLightsWorldForest = new URL("../../assets/lights/forest.exr", import.meta.url).href;

class Room3D {
    constructor(container = document.body) {
        this.container = container;
        this.camera = null;
        this.controls = null;
        this.rayCaster = new THREE.Raycaster();
        this.mousePos = new THREE.Vector2();
        this.model = null;
        this.playerBB = new THREE.Box3();
        this.playerBBSize = new THREE.Vector3(1, 2, 1); // define once
        this.oldPosition = new THREE.Vector3();
        this.colliders = [];

        // joystick controls
        this.yaw = 0;
        this.pitch = 0;
        this.lookDelta = { x: 0, y: 0 };

        // Movement state
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.move = { forward: false, backward: false, left: false, right: false };

        this.clock = new THREE.Clock();
        this.initRenderer();
        this.initScene();
        this.initCamera();
        this.initControls();
        this.initLights();
        this.initPlane();
        //this.initGrid();
        this.initJoystick();
        this.loadModel(); // Uncomment if you want to load the GLTF
        this.initSky();
        this.animate();

        // for head-bob
        this.walkTime = 0;
        this.baseHeight = 5;

        this._initEvents();
        this._initTouchControls();

        window.addEventListener("resize", () => this.onWindowResize());
    }

    initRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setClearColor(0xffffff, 1);
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);
    }

    initEnvironment() {
        // Example using EXR
        const loader = new EXRLoader();
        loader.load(studioLightsWorldForest, (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            this.scene.background = texture;
            // Apply as scene environment (for reflections, PBR materials)
            this.scene.environment = texture;
        });

        // Example using HDR instead:
        // new RGBELoader().load('/textures/forest.hdr', (texture) => {
        //     texture.mapping = THREE.EquirectangularReflectionMapping;
        //     this.scene.background = texture;
        //     this.scene.environment = texture;
        // });
    }

    updateCameraLook() {
        const sensitivity = 0.05; // adjust like mouse sensitivity
        const smoothing = 0.15;   // smaller = more lag/smooth

        // interpolate joystick effect for smoothness
        this.yaw -= this.lookDelta.x * sensitivity * smoothing;
        this.pitch += this.lookDelta.y * sensitivity * smoothing;

        // clamp pitch to avoid flipping
        this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));

        // apply to camera
        this.camera.rotation.order = "YXZ";
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
    }

    initJoystick() {
        const joystick = nipplejs.create({
            zone: document.getElementById("joystick"),
            mode: "static",
            position: { left: "50%", top: "50%" },
            color: "white",
            size: 100
        });

        joystick.on("move", (evt, data) => {
            if (!data.direction) {
                // stop influence when joystick is released
                this.lookDelta.x = 0;
                this.lookDelta.y = 0;
                return;
            }

            // instead of setting absolute rotation, store joystick force
            const force = data.distance / 100; // normalize 0–1
            this.lookDelta.x = Math.cos(data.angle.radian) * force;
            this.lookDelta.y = Math.sin(data.angle.radian) * force;
        });


        joystick.on("end", () => {
            // reset look influence (stop rotating when released)
            this.lookDelta.x = 0;
            this.lookDelta.y = 0;
        });

    }

    initScene() {
        this.scene = new THREE.Scene();
        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);
    }

    initCamera() {
        this.camera = new THREE.PerspectiveCamera(
            45,
            this.container.clientWidth / this.container.clientHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 0, 0);
        this.camera.lookAt(0, 0, 0);  // looks toward the castle at eye-level
    }

    initControls() {
        // this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
        // this.orbit.update();
        this.controls = new PointerLockControls(this.camera, this.container);
        this.scene.add(this.controls.object);
    }

    initLights() {
        this.initEnvironment();
    }

    initPlane() {
    }

    initSky() {
    }

    initGrid() {
        const gridHelper = new THREE.GridHelper(30);
        this.scene.add(gridHelper);
    }

    loadModel() {

        // Setup DRACO loader if draco compression used
        const dracoLoader = new DRACOLoader();
        // Use the CDN or host the decoder files locally
        dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');

        this.mixer = null;
        const loader = new GLTFLoader();
        loader.setDRACOLoader(dracoLoader);
        loader.load(monkeyUrl.href, (gltf) => {
            const model = gltf.scene;
            this.model = model;
            this.scene.add(model);
            model.position.set(0, 0, 0);
            model.scale.set(2, 2, 2); // doubles the size

            // this.mixer = new THREE.AnimationMixer(model);
            // gltf.animations.forEach((clip) => {
            //     const action = this.mixer.clipAction(clip);
            //     action.play();
            // });

            model.traverse((child) => {

                if (child.isMesh) {
                    if (child.name.startsWith("Wall")) {
                        child.userData.boundingBox = new THREE.Box3().setFromObject(child);
                        child.userData.boundingBox.max.y = 10;

                        this.colliders.push(child);
                    }
                    child.material.transparent = false;
                    child.material.transmission = 0;
                    child.material.opacity = 1;
                    console.log(`mesh: ${child.name} `, child)
                } else {
                    if (
                        (child.name.startsWith("Wall") || child.name.startsWith("Hotspot") || child.name.startsWith("Podium")
                            || child.name.startsWith("Reception") || child.name.startsWith("Sofa") || child.name.startsWith("Table"))
                        && child.isGroup) {

                        child.children.map(c => {
                            if (c.isMesh) {
                                c.userData.boundingBox = new THREE.Box3().setFromObject(c);
                                c.userData.boundingBox.max.y = 10;

                                this.colliders.push(c);
                            }
                        })
                    }
                    console.log(`not mesh: ${child.name} `, child)
                }

            });

        }, undefined, (error) => {
            console.error(error);
        });
    }

    _initTouchControls() {
        const map = {
            "up": "forward",
            "down": "backward",
            "left": "left",
            "right": "right"
        };

        Object.entries(map).forEach(([id, dir]) => {
            const el = document.getElementById(id);
            if (!el) return;

            const press = () => this.move[dir] = true;
            const release = () => this.move[dir] = false;

            el.addEventListener("touchstart", press);
            el.addEventListener("mousedown", press);

            el.addEventListener("touchend", release);
            el.addEventListener("mouseup", release);
            el.addEventListener("mouseleave", release);
        });
    }


    _initEvents() {
        document.addEventListener("keydown", (e) => this._onKeyDown(e));
        document.addEventListener("keyup", (e) => this._onKeyUp(e));

        // click to lock pointer
        document.body.addEventListener("click", () => {
            //this.controls.lock();
        });

        //this.container.addEventListener("mousemove", function (e) {
        //if (this.mousePos) {
        //this.mousePos.x = (e.clientX / this.container.clientWidth) * 2 - 1;
        //this.mousePos.y = (e.clientY / this.container.clientHeight) * 2 - 1;
        //}
        //})

    }

    _onKeyDown(event) {
        switch (event.code) {
            case "KeyW": this.move.forward = true; break;
            case "KeyS": this.move.backward = true; break;
            case "KeyA": this.move.left = true; break;
            case "KeyD": this.move.right = true; break;
        }
    }

    _onKeyUp(event) {
        switch (event.code) {
            case "KeyW": this.move.forward = false; break;
            case "KeyS": this.move.backward = false; break;
            case "KeyA": this.move.left = false; break;
            case "KeyD": this.move.right = false; break;
        }
    }

    update(delta) {
        this.direction.z = Number(this.move.forward) - Number(this.move.backward);
        this.direction.x = Number(this.move.right) - Number(this.move.left);
        this.direction.normalize();

        if (this.move.forward || this.move.backward) this.velocity.z -= this.direction.z * 50 * delta;
        if (this.move.left || this.move.right) this.velocity.x -= this.direction.x * 50 * delta;

        this.controls.moveRight(-this.velocity.x * delta);
        this.controls.moveForward(-this.velocity.z * delta);

        // damping for smooth stop
        this.velocity.x -= this.velocity.x * 10.0 * delta;
        this.velocity.z -= this.velocity.z * 10.0 * delta;

        // --- NEW: Head-bob shaky movement ---
        if (this.move.forward || this.move.backward || this.move.left || this.move.right) {
            this.walkTime += delta * 10; // step speed factor
            //
            this.controls.object.position.y = this.baseHeight + Math.sin(this.walkTime) * 0.1;
        } else {
            this.walkTime = 0;
            this.controls.object.position.y = this.baseHeight;
        }
    }

    RaysCaster() {
        this.rayCaster.setFromCamera(this.mousePos, this.camera)
        const intersects = this.rayCaster.intersectObjects(this.scene.children);
        console.log(intersects)
    }

    // updateBoundingBoxes() {
    //     if (this.model) {
    //         this.colliders.map((child) => {
    //             if (child.isMesh && child.userData.boundingBox) {
    //                 child.userData.boundingBox.setFromObject(child);
    //                 child.userData.boundingBox.max.y = 10;
    //             }
    //         });
    //     }
    // }

    updateBoundingBoxes() {
        if (!this.model) return;
        const tempBox = new THREE.Box3();
        this.colliders.map((child) => {
            if (child.isMesh && child.userData.boundingBox) {
                tempBox.setFromObject(child);
                child.userData.boundingBox.copy(tempBox);
                child.userData.boundingBox.max.y = 10; // keep clamp
            }
        });
    }


    updatePlayerBB() {
        if (this.playerBB && this.controls) {
            // Full Body
            this.playerBB.setFromCenterAndSize(
                this.controls.object.position,
                this.playerBBSize
            );
        }
    }

    checkCollisions(oldPosition) {
        let collided = false;
        let name = "none"
        let inPlay = null;

        if (this.model) {
            this.colliders.map((child) => {
                if (child.isMesh && child.userData.boundingBox) {
                    if (this.playerBB.intersectsBox(child.userData.boundingBox)) {
                        collided = true;
                        name = child.name;
                        inPlay = child;
                    }
                }
            });

            if (collided) {
                //console.log("collision")
                //console.log(inPlay)
                // Stop movement (restore old position)
                this.controls.object.position.copy(oldPosition);
            }
        }
    }

    animate() {
        //if (this.mixer) this.mixer.update(this.clock.getDelta());
        // const oldPosition = this.controls.object.position.clone();

        if (this.oldPosition)
            this.oldPosition.copy(this.controls.object.position);

        this.updateCameraLook();
        this.update(this.clock.getDelta());
        this.updatePlayerBB();
        this.updateBoundingBoxes();
        //this.RaysCaster();
        this.checkCollisions(this.oldPosition);

        this.renderer.render(this.scene, this.camera);
        this.renderer.setAnimationLoop(() => this.animate());
    }

    onWindowResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }
}

// Usage
const room = new Room3D(document.getElementById("canvas-div"));

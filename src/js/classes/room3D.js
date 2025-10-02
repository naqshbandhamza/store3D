import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import nipplejs from "nipplejs";

const monkeyUrl = new URL("../../assets/glb/roomop1.glb", import.meta.url);
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
        this.playerBBSize = new THREE.Vector3(0.6, 1.8, 0.6);
        this.oldPosition = new THREE.Vector3();
        this.colliders = [];
        this.controlMode = "joystick"; // "joystick" or "pointer"

        // joystick controls
        this.yaw = 0;
        this.pitch = 0;
        this.lookDelta = { x: 0, y: 0 };

        this._tempBox;

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
        this.initJoystick();
        this.loadModel();
        this.animate();

        // bind animate so we can pass it to setAnimationLoop once
        this.animate = this.animate.bind(this);
        this.renderer.setAnimationLoop(this.animate);

        // for head-bob
        this.walkTime = 0;
        this.baseHeight = 1.7;

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
        const loader = new EXRLoader();
        loader.load(studioLightsWorldForest, (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            this.scene.background = texture;
            this.scene.environment = texture;
        });
    }

    updateCameraLook() {
        const sensitivity = 0.1; // adjust like mouse sensitivity
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
        //const axesHelper = new THREE.AxesHelper(5);
        //this.scene.add(axesHelper);
    }

    initCamera() {
        this.camera = new THREE.PerspectiveCamera(
            70,
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
        
            // this.mixer = new THREE.AnimationMixer(model);
            // gltf.animations.forEach((clip) => {
            //     const action = this.mixer.clipAction(clip);
            //     action.play();
            // });

            model.traverse((child) => {

                if (child.isMesh) {
                    if (child.name.startsWith("Wall")) {

                        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                        child.userData.localBoundingBox = child.geometry.boundingBox.clone();
                        child.userData.boundingBox = new THREE.Box3(); // world-space box

                        this.colliders.push(child);
                    }
                    child.material.transparent = false;
                    child.material.transmission = 0;
                    child.material.opacity = 1;
                   
                } else {
                    if (
                        (child.name.startsWith("Wall") || child.name.startsWith("Hotspot") || child.name.startsWith("Podium")
                            || child.name.startsWith("Reception") || child.name.startsWith("Sofa") || child.name.startsWith("Table"))
                        && child.isGroup) {

                        child.children.map(c => {
                            if (c.isMesh) {

                                if (!c.geometry.boundingBox) c.geometry.computeBoundingBox();
                                c.userData.localBoundingBox = c.geometry.boundingBox.clone();
                                c.userData.boundingBox = new THREE.Box3(); // world-space box

                                this.colliders.push(c);
                            }
                        })
                    }
                    
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
        document.body.addEventListener("keydown", (e) => {
            if (e.code === "KeyP") {
                if (this.controlMode === "joystick") {
                    this.controlMode = "pointer";
                    this.controls.lock();
                } else {
                    this.controlMode = "joystick";
                    this.controls.unlock();

                    // Sync yaw/pitch from camera orientation
                    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
                    this.yaw = euler.y;
                    this.pitch = euler.x;
                }
                console.log("Control mode:", this.controlMode);
            }
        });

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
        const moving = this.direction.lengthSq() > 0;

        if (moving) this.direction.normalize();

        const speed = 2;
        const targetVelocityX = this.direction.x * speed;
        const targetVelocityZ = this.direction.z * speed;

        const acceleration = 10;
        this.velocity.x += (targetVelocityX - this.velocity.x) * Math.min(acceleration * delta, 1);
        this.velocity.z += (targetVelocityZ - this.velocity.z) * Math.min(acceleration * delta, 1);

        this.controls.moveRight(this.velocity.x * delta);
        this.controls.moveForward(this.velocity.z * delta);

        if (moving) {
            this.walkTime += delta * 10;
            this.controls.object.position.y = this.baseHeight + Math.sin(this.walkTime) * 0.025;
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

    updateBoundingBoxes() {

        if (!this.model || this.colliders.length === 0) return;
        if (!this._tempBox) this._tempBox = new THREE.Box3();

        for (let i = 0; i < this.colliders.length; i++) {
            const mesh = this.colliders[i];
            if (!mesh.userData.localBoundingBox) continue;
            this._tempBox.copy(mesh.userData.localBoundingBox);
            this._tempBox.applyMatrix4(mesh.matrixWorld);
            this._tempBox.max.y = 10;
            mesh.userData.boundingBox.copy(this._tempBox);
        }

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

            for (let i = 0; i < this.colliders.length; i++) {
                const child = this.colliders[i];
                if (child.isMesh && child.userData.boundingBox) {
                    if (this.playerBB.intersectsBox(child.userData.boundingBox)) {
                        collided = true;
                        name = child.name;
                        inPlay = child;
                        break; // optional: stop checking further if a collision is found
                    }
                }
            }


            if (collided) {
                // Stop movement (restore old position)
                this.controls.object.position.copy(oldPosition);
            }
        }
    }

    animate() {
        //if (this.mixer) this.mixer.update(this.clock.getDelta());

        if (this.oldPosition)
            this.oldPosition.copy(this.controls.object.position);

        if (this.controlMode === "joystick")
            this.updateCameraLook();
        this.update(this.clock.getDelta());
        this.updatePlayerBB();
        this.updateBoundingBoxes();
        //this.RaysCaster();
        this.checkCollisions(this.oldPosition);

        this.renderer.render(this.scene, this.camera);
        // this.renderer.setAnimationLoop(() => this.animate());
    }

    onWindowResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }
}

// Usage
const room = new Room3D(document.getElementById("canvas-div"));

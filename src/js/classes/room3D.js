import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

const monkeyUrl = new URL("../../assets/glb/store3.glb", import.meta.url);
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
        this.collisionWith = "";
        this.collisionWithObj = null;

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
        this.loadModel(); // Uncomment if you want to load the GLTF
        this.initSky();
        this.animate();

        // for head-bob
        this.walkTime = 0;
        this.baseHeight = 5;

        this._initEvents();

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
            // Apply as scene background
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

        // Setup DRACO loader
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
                    console.log("mesh: ", child.name)
                    if (child.name.startsWith("Wall"))
                    {
                        child.userData.boundingBox = new THREE.Box3().setFromObject(child);
                        console.log(child)
                    }
                    child.material.transparent = false;
                    child.material.transmission = 0;
                    child.material.opacity = 1;
                } else {
                    console.log("not mesh:", child.name)
                    if (child.name.startsWith("Wall") && child.isGroup)
                    {
                        console.log(child)
                        child.children.map(c=>{
                            if(c.isMesh){
                                c.userData.boundingBox = new THREE.Box3().setFromObject(c);
                            }
                        })
                    }
                }
            });

        }, undefined, (error) => {
            console.error(error);
        });
    }

    _initEvents() {
        document.addEventListener("keydown", (e) => this._onKeyDown(e));
        document.addEventListener("keyup", (e) => this._onKeyUp(e));

        // click to lock pointer
        document.body.addEventListener("click", () => {
            this.controls.lock();
        });

        this.container.addEventListener("mousemove", function (e) {
            if (this.mousePos) {
                this.mousePos.x = (e.clientX / this.container.clientWidth) * 2 - 1;
                this.mousePos.y = (e.clientY / this.container.clientHeight) * 2 - 1;
            }
        })

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
        this.collisionWith = "";
        this.collisionWithObj = null;
        for (let i = 0; i < intersects.length; i++) {
            this.collisionWithObj = intersects[i];
        }
    }

    updateBoundingBoxes() {
        if (this.model) {
            this.model.traverse((child) => {
                if (child.isMesh && child.userData.boundingBox) {
                    child.userData.boundingBox.setFromObject(child);
                }
            });
        }
    }

    updatePlayerBB() {
        if (this.playerBB && this.controls) {
            this.playerBB.setFromCenterAndSize(
                this.controls.object.position,
                new THREE.Vector3(1, 2, 1) // size of the player
            );
        }
    }

    checkCollisions(oldPosition) {
        let collided = false;
        let name = "none"
        let inPlay = null;

        if (this.model) {
            this.model.traverse((child) => {
                if (child.isMesh && child.userData.boundingBox) {
                    if (this.playerBB.intersectsBox(child.userData.boundingBox)) {
                        collided = true;
                        name = child.name;
                        inPlay = child;
                    }
                }
            });

            if (collided) {
                console.log(this.collisionWithObj)
                // Stop movement (restore old position)
                this.controls.object.position.copy(oldPosition);
            }
        }
    }

    animate() {
        if (this.mixer) this.mixer.update(this.clock.getDelta());

        const oldPosition = this.controls.object.position.clone();

        this.update(this.clock.getDelta());

        this.updatePlayerBB();

        this.updateBoundingBoxes()

        this.RaysCaster();

        this.checkCollisions(oldPosition);

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

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.127.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.127.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.127.0/examples/jsm/controls/OrbitControls.js";

// Constants for configuration
const MODES = {
    VIEWER: 'viewer',
    FLOOR: 'floor',
    WALL: 'wall',
    GPS: 'gps',
    ANCHORS: 'anchors'
};

const AR_CONFIG = { //Default config
    DETECTION_RADIUS: 10, // meters
    MODEL_HEIGHT: 1.5,
    MODEL_SCALE: 0.5,
    EARTH_RADIUS: 6378137 // meters
};

class SceneManager {
    constructor(container, mode) {
        this.container = container;
        this.mode = mode;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
    }

    createScene(width, height, options = {}) {
        this.scene = new THREE.Scene();

        if (this.mode === MODES.VIEWER) {
            this.scene.background = new THREE.Color(0xaaaaaa);
        }

        this.camera = new THREE.PerspectiveCamera(
            75,
            width / height,
            0.1,
            1000
        );

        if (options.cameraPosition) {
            this.camera.position.set(
                options.cameraPosition.x,
                options.cameraPosition.y,
                options.cameraPosition.z
            );
        }

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true
        });
        this.renderer.setSize(width, height);

        if (this.mode !== MODES.VIEWER) {
            this.renderer.xr.enabled = true;
        }

        this.container.appendChild(this.renderer.domElement);

        this.addLighting();
        return this;
    }

    addLighting() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);

        directionalLight.position.set(5, 10, 5);
        directionalLight.castShadow = true;

        this.scene.add(ambientLight);
        this.scene.add(directionalLight);

        return this;
    }

    setupResizeObserver() {
        const resizeObserver = new ResizeObserver(() => {
            this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        });
        resizeObserver.observe(this.container);
        return this;
    }
}

class ModelLoader {
    constructor(scene) {
        this.scene = scene;
        this.loader = new GLTFLoader();
    }

    loadModel(modelSrc, options = {}) {
        return new Promise((resolve, reject) => {
            this.loader.load(
                modelSrc,
                (gltf) => {
                    const object = gltf.scene;
                    object.scale.set(
                        options.scale || AR_CONFIG.MODEL_SCALE,
                        options.scale || AR_CONFIG.MODEL_SCALE,
                        options.scale || AR_CONFIG.MODEL_SCALE
                    );

                    if (options.position) {
                        object.position.set(
                            options.position.x,
                            options.position.y,
                            options.position.z
                        );
                    }

                    this.scene.add(object);
                    resolve(object);
                },
                undefined,
                (error) => reject(error)
            );
        });
    }
}

class GeolocationManager {
    static calculateDistance(lat1, lon1, lat2, lon2) {
        const R = AR_CONFIG.EARTH_RADIUS;
        const toRad = (deg) => deg * (Math.PI / 180);

        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);

        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    static convertGPSToMeters(lat, lon, refLat, refLon) {
        const R = AR_CONFIG.EARTH_RADIUS;
        const dLat = (lat - refLat) * (Math.PI / 180) * R;
        const dLon = (lon - refLon) * (Math.PI / 180) * R * Math.cos((refLat * Math.PI) / 180);

        return { x: dLon, z: -dLat };
    }
}

class KitCoreWebAR extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this.container = document.createElement("div");
        this.container.style.width = "100%";
        this.container.style.height = "100%";
        this.container.style.position = "relative";
        this.shadowRoot.appendChild(this.container);

        this.domOverlayContainer = document.createElement("div");
        this.domOverlayContainer.id = "dom-overlay";
        this.domOverlayContainer.style.display = "flex";
        this.domOverlayContainer.style.justifyContent = "end";
        this.domOverlayContainer.style.alignItems = "center";
        this.domOverlayContainer.style.flexDirection = "column";
        this.domOverlayContainer.style.color = "white";
        this.domOverlayContainer.style.fontSize = "25px";
        this.domOverlayContainer.style.paddingBottom = "50px";
        this.domOverlayContainer.style.fontFamily = "Arial, sans-serif";
        this.domOverlayContainer.style.textAlign = "center";
        this.domOverlayContainer.style.display = "none";
        this.shadowRoot.appendChild(this.domOverlayContainer);

        this.mode = this.getAttribute("mode") || MODES.VIEWER;
        this.objects = [];
        this.autoGenerateButton = this.getAttribute("auto-button") !== "false";
        this.init();
    }

    init() {
        if (this.mode === MODES.VIEWER) {
            this.initViewerMode();
        } else {
            this.setupARButton();
        }
    }

    setupARButton() {
        this.userButton = document.querySelector("[kitcore-webar-button]");

        if (!this.userButton && this.autoGenerateButton) {
            this.createAutoButton();
        } else if (this.userButton) {
            this.userButton.addEventListener("click", () => this.requestWebXRSession());
        }
    }

    createAutoButton() {
        this.startButton = document.createElement("button");
        this.startButton.innerText = "Start AR";
        this.startButton.style.position = "absolute";
        this.startButton.style.top = "20px";
        this.startButton.style.left = "50%";
        this.startButton.style.transform = "translateX(-50%)";
        this.startButton.style.padding = "10px 20px";
        this.startButton.style.fontSize = "16px";
        this.startButton.style.background = "red";
        this.startButton.style.color = "white";
        this.startButton.style.border = "none";
        this.startButton.style.cursor = "pointer";
        document.body.appendChild(this.startButton);

        this.startButton.addEventListener("click", () =>
            this.requestWebXRSession()
        );
    }

    async requestWebXRSession() {
        if (!navigator.xr) {
            console.error("WebXR is not supported on this device.");
            alert("Your device does not support WebXR.");
            return;
        }

        try {
            console.log(`Attempting to start WebXR in mode: ${this.mode}`);
            if (this.mode === MODES.VIEWER) {
                this.openSceneViewer();
                return;
            }

            let sessionInit = {};
            if (this.mode === MODES.ANCHORS) {
                sessionInit = {
                    requiredFeatures: ["local-floor", "anchors"],
                    optionalFeatures: ["dom-overlay"],
                    domOverlay: { root: this.domOverlayContainer }
                };
            } else {
                sessionInit = {
                    requiredFeatures: ["local-floor", "hit-test"],
                    optionalFeatures: ["dom-overlay", "plane-detection"],
                    domOverlay: { root: this.domOverlayContainer }
                };
            }

            this.session = await navigator.xr.requestSession("immersive-ar", sessionInit);

            this.domOverlayContainer.style.display = "flex";
            console.log("WebXR activated.");
            this.initScene();

            if (this.startButton) this.startButton.remove();
        } catch (error) {
            console.error("Error activating WebXR:", error);
            alert("Failed to activate WebXR. Please try again.");
        }
    }

    initScene() {
        if (this.mode === MODES.VIEWER) {
            this.initViewerMode();
            return;
        }

        // Create scene manager
        this.sceneManager = new SceneManager(this.container, this.mode)
            .createScene(window.innerWidth, window.innerHeight);

        // Initialize model loader
        this.modelLoader = new ModelLoader(this.sceneManager.scene);

        // Add camera to scene
        this.sceneManager.scene.add(this.sceneManager.camera);

        // Handle different AR modes
        if (this.mode === MODES.FLOOR || this.mode === MODES.WALL) {
            if (this.mode === MODES.FLOOR) {
                this.domOverlayContainer.innerText = "Move around to detect a surface";
            } else {
                this.domOverlayContainer.innerText = "Move to find a vertical surface";
            }
            this.enablePlacement();
        }

        if (this.mode === MODES.GPS) {
            this.loadObjects();
            this.enableGPS();
        }

        if (this.mode === MODES.ANCHORS) {
            this.loadObjects();
            this.enableAnchors();
        }

        // Set XR session
        this.sceneManager.renderer.xr.setSession(this.session);
        // GPS mode rendering loop
        if (this.mode === MODES.GPS) {
            this.sceneManager.renderer.setAnimationLoop(() => {
                this.objects.forEach(obj => {
                    if (obj.lookatuser && obj.object.visible) {
                        obj.object.lookAt(this.sceneManager.camera.position);
                    }
                });
                this.sceneManager.renderer.render(
                    this.sceneManager.scene,
                    this.sceneManager.camera
                );
            });
        }
    }

    loadObjects() {
        this.querySelectorAll("kitcore-webar-object").forEach((element) => {
            const lat = parseFloat(element.getAttribute("lat"));
            const lon = parseFloat(element.getAttribute("lon"));
            const src = element.getAttribute("src");
            const distance = parseFloat(element.getAttribute("distance")) || null;
            const altitude = parseFloat(element.getAttribute("altitude")) || AR_CONFIG.MODEL_HEIGHT;
            const lookatuser = element.getAttribute("lookatuser") === "true";

            if (lat && lon && src) {
                this.addObject(lat, lon, src, distance, altitude, lookatuser);
            }
        });
    }
    async addObject(lat, lon, modelSrc, distance = null, altitude = AR_CONFIG.MODEL_HEIGHT, lookatuser = false) {
        try {
            const object = await this.modelLoader.loadModel(modelSrc, {
                scale: AR_CONFIG.MODEL_SCALE,
            });

            object.visible = false;
            this.objects.push({ lat, lon, object, distance, altitude, lookatuser, anchor: null });
        } catch (error) {
            console.error("Error loading object:", error);
        }
    }

    enableGPS() {
        navigator.geolocation.watchPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;
                this.objects.forEach(({ lat, lon, object, distance, altitude }) => {
                    const detectionRadius = distance || this.getAttribute("distance") || AR_CONFIG.DETECTION_RADIUS;
                    const distanceToUser = GeolocationManager.calculateDistance(
                        userLat, userLon, lat, lon
                    );

                    if (distanceToUser < detectionRadius) {
                        object.visible = true;
                        const { x, z } = GeolocationManager.convertGPSToMeters(
                            lat, lon, userLat, userLon
                        );

                        object.position.set(x, altitude, z);
                    } else {
                        object.visible = false;
                    }
                });
            },
            (error) => console.error("Error obtaining geolocation:", error),
            { enableHighAccuracy: true }
        );
    }

    enableAnchors() {
        navigator.geolocation.watchPosition(
            (position) => {
                this.currentUserLat = position.coords.latitude;
                this.currentUserLon = position.coords.longitude;
            },
            (error) => console.error("Error obtaining geolocation:", error),
            { enableHighAccuracy: true }
        );

        this.sceneManager.renderer.setAnimationLoop((timestamp, frame) => {
            if (frame && this.currentUserLat !== undefined && this.currentUserLon !== undefined) {
                const referenceSpace = this.sceneManager.renderer.xr.getReferenceSpace();
                this.objects.forEach((obj) => {
                    const detectionRadius = obj.distance || this.getAttribute("distance") || AR_CONFIG.DETECTION_RADIUS;
                    const distanceToUser = GeolocationManager.calculateDistance(
                        this.currentUserLat,
                        this.currentUserLon,
                        obj.lat,
                        obj.lon
                    );
                    if (distanceToUser < detectionRadius) {
                        if (!obj.anchor) {
                            const { x, z } = GeolocationManager.convertGPSToMeters(
                                obj.lat,
                                obj.lon,
                                this.currentUserLat,
                                this.currentUserLon
                            );
                            const y = obj.altitude;
                            const transform = new XRRigidTransform({ x, y, z });
                            frame.createAnchor(transform, referenceSpace)
                                .then((anchor) => {
                                    obj.anchor = anchor;
                                    obj.object.visible = true;
                                })
                                .catch((err) => {
                                    console.error("Error creating anchor:", err);
                                });
                        } else {
                            const anchorPose = frame.getPose(obj.anchor.anchorSpace, referenceSpace);
                            if (anchorPose) {
                                obj.object.position.set(
                                    anchorPose.transform.position.x,
                                    anchorPose.transform.position.y,
                                    anchorPose.transform.position.z
                                );
                                obj.object.quaternion.set(
                                    anchorPose.transform.orientation.x,
                                    anchorPose.transform.orientation.y,
                                    anchorPose.transform.orientation.z,
                                    anchorPose.transform.orientation.w
                                );
                                obj.object.visible = true;
                            }
                        }
                    } else {
                        obj.object.visible = false;
                        if (obj.anchor) {
                            if (typeof obj.anchor.delete === "function") {
                                obj.anchor.delete();
                            }
                            obj.anchor = null;
                        }
                    }
                    if (obj.lookatuser && obj.object.visible) {
                        obj.object.lookAt(this.sceneManager.camera.position);
                    }
                });
            }
            this.sceneManager.renderer.render(this.sceneManager.scene, this.sceneManager.camera);
        });
    }

    enablePlacement() {
        const objectElem = this.querySelector("kitcore-webar-object");
        if (!objectElem) {
            console.error("Couldn't find element <kitcore-webar-object>.");
            return;
        }
        const modelSrc = objectElem.getAttribute("src");
        if (!modelSrc) {
            console.error("Attribute 'src' not defined in <kitcore-webar-object>.");
            return;
        }
        this.modelLoader.loadModel(modelSrc)
            .then((placedObject) => {
                this.placedObject = placedObject;
                this.placedObject.visible = false;
            })
            .catch(error => console.error("Error loading placement model:", error));

        this.session
            .requestReferenceSpace("viewer")
            .then((viewerSpace) => {
                return this.session.requestHitTestSource({
                    space: viewerSpace,
                    entityTypes: [this.mode === "wall" ? "vertical-plane" : "plane"],
                });
            })
            .then((hitTestSource) => {
                this.hitTestSource = hitTestSource;

                this.sceneManager.renderer.setAnimationLoop((timestamp, frame) => {
                    if (frame && this.hitTestSource) {
                        const hitTestResults = frame.getHitTestResults(this.hitTestSource);

                        if (hitTestResults.length > 0) {
                            const referenceSpace =
                                this.sceneManager.renderer.xr.getReferenceSpace();
                            const hitPose = hitTestResults[0].getPose(referenceSpace);

                            if (this.mode === "wall") {
                                const normal = hitPose.transform.orientation;
                                const isVertical = this.isVerticalSurface(normal);
                                if (!this.placedObject.visible) {
                                    if (isVertical) {
                                        this.domOverlayContainer.innerText = "Wall detected, tap to place";
                                    } else {
                                        this.domOverlayContainer.innerText = "Surface detected, tap to place";
                                    }
                                }
                            } else {
                                if (!this.placedObject.visible) {
                                    this.domOverlayContainer.innerText = "Surface detected, tap to place";
                                }
                            }
                        } else {
                            if (!this.placedObject.visible) {
                                if (this.mode === "wall") {
                                    this.domOverlayContainer.innerText = "Move to find a vertical surface";
                                }
                                else {
                                    this.domOverlayContainer.innerText = "Move around to detect a surface";
                                }
                            }
                        }

                        this.sceneManager.renderer.render(
                            this.sceneManager.scene,
                            this.sceneManager.camera
                        );
                    }
                });
            });

        this.session.addEventListener("select", (event) => {
            const frame = event.frame;
            const referenceSpace = this.sceneManager.renderer.xr.getReferenceSpace();
            if (!this.hitTestSource) {
                console.warn("hitTestSource is not defined");
                return;
            }
            const hitTestResults = frame.getHitTestResults(this.hitTestSource);
            if (hitTestResults.length > 0 && this.placedObject) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(referenceSpace);
                if (pose) {
                    if (this.mode === "wall") {
                        // Adjust the rotation of the object to match the wall normal
                        this.placedObject.quaternion.copy(pose.transform.orientation);
                    }
                    this.placedObject.visible = true;
                    this.placedObject.position.copy(pose.transform.position);
                }
                if (this.domOverlayContainer && this.placedObject.visible) {
                    this.domOverlayContainer.innerText = "";
                }
            }
        });
    }

    isVerticalSurface(orientation) {
        const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(
            new THREE.Quaternion(
                orientation.x,
                orientation.y,
                orientation.z,
                orientation.w
            )
        );

        const normal = new THREE.Vector3(0, 0, 1).applyMatrix4(rotationMatrix);

        const verticalVector = new THREE.Vector3(0, 1, 0);
        const angle = normal.angleTo(verticalVector);

        const verticalThreshold = Math.PI / 4;

        return Math.abs(angle - Math.PI / 2) < verticalThreshold;
    }

    initViewerMode() {
        const objectElem = this.querySelector("kitcore-webar-object");
        if (!objectElem) {
            console.error("Couldn't find element <kitcore-webar-object>.");
            return;
        }
        const modelSrc = objectElem.getAttribute("src");
        if (!modelSrc) {
            console.error(
                "Attribute 'src' not defined in <kitcore-webar-object>."
            );
            return;
        }

        // Create scene manager for viewer mode
        this.sceneManager = new SceneManager(this.container, this.mode)
            .createScene(
                this.container.clientWidth,
                this.container.clientHeight,
                {
                    cameraPosition: { x: 0, y: 1, z: 3 }
                }
            )
            .setupResizeObserver();

        // Setup orbit controls for viewer mode
        this.controls = new OrbitControls(
            this.sceneManager.camera,
            this.sceneManager.renderer.domElement
        );
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 1;
        this.controls.maxDistance = 10;
        this.controls.target.set(0, 1, 0);
        this.controls.update();

        // Load model
        const modelLoader = new ModelLoader(this.sceneManager.scene);
        modelLoader.loadModel(modelSrc, {
            scale: 1,
            position: { x: 0, y: 0, z: 0 }
        }).then((model) => {
            this.model = model;
        }).catch((error) => {
            console.error("Error loading the model:", error);
        });

        // Animation loop
        this.sceneManager.renderer.setAnimationLoop(() => {
            this.controls.update();
            this.sceneManager.renderer.render(
                this.sceneManager.scene,
                this.sceneManager.camera
            );
        });

        // Create scene viewer button
        this.createSceneViewerButton(modelSrc);
    }

    createSceneViewerButton() {
        const objectElem = this.querySelector("kitcore-webar-object");
        if (!objectElem) {
            console.error("Couldn't find element <kitcore-webar-object>.");
            return;
        }

        const isIOS = (
            /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
            (navigator.userAgentData && navigator.userAgentData.platform === "iOS")
        );

        const modelSrc = objectElem.getAttribute("src");
        const usdzSrc = objectElem.getAttribute("usdz");

        if (!modelSrc) {
            console.error("Attribute 'src' not defined in <kitcore-webar-object>.");
            return;
        }

        if (isIOS && !usdzSrc) {
            console.error("Attribute 'usdz' not defined in <kitcore-webar-object>.");
            return;
        }
        this.arButton = document.createElement("button");
        this.arButton.innerText = "View in AR";
        this.arButton.style.position = "absolute";
        this.arButton.style.bottom = "20px";
        this.arButton.style.left = "50%";
        this.arButton.style.transform = "translateX(-50%)";
        this.arButton.style.padding = "10px 20px";
        this.arButton.style.fontSize = "16px";
        this.arButton.style.background = "blue";
        this.arButton.style.color = "white";
        this.arButton.style.border = "none";
        this.arButton.style.cursor = "pointer";

        this.container.appendChild(this.arButton);

        this.arButton.addEventListener("click", () =>
            this.openSceneViewer(modelSrc, usdzSrc)
        );
    }

    openSceneViewer(modelSrc, usdzSrc) {
        const isIOS = (
            /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ||
            (navigator.userAgentData && navigator.userAgentData.platform === "iOS")
        );

        if (isIOS && usdzSrc) {
            // Open the model in Quick Look
            const anchor = document.createElement("a");
            anchor.setAttribute("rel", "ar");
            anchor.setAttribute("href", usdzSrc);
            anchor.click();
        } else {
            // Open the model in Google Scene Viewer
            window.location.href = `intent://arvr.google.com/scene-viewer/1.0?file=${modelSrc}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;end;`;
        }
    }
}

customElements.define("kitcore-webar", KitCoreWebAR);

export {
    KitCoreWebAR,
    SceneManager,
    ModelLoader,
    GeolocationManager,
    MODES,
    AR_CONFIG,
};

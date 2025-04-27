import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.127.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.127.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.127.0/examples/jsm/controls/OrbitControls.js";

// Constants for configuration
const MODES = {
    VIEWER: 'viewer',
    FLOOR: 'floor',
    WALL: 'wall',
    GPS: 'gps',
    ANCHORS: 'anchors',
    SCENE: 'scene'
};

const AR_CONFIG = { // Default config
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

        // Background handling
        if (this.mode === MODES.VIEWER) {
            this.scene.background = new THREE.Color(0xaaaaaa);
        } else if (this.mode === MODES.SCENE && !this.renderer?.xr.isPresenting) { // Only set background for initial scene view
            this.scene.background = new THREE.Color(0xdddddd);
        } else {
            // AR modes typically have transparent background handled by WebXR compositor
        }


        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);

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
        this.renderer.setPixelRatio(window.devicePixelRatio); // Better resolution on high DPI screens

        // XR is enabled later in requestWebXRSession or initScene if needed
        // if (this.mode !== MODES.VIEWER && this.mode !== MODES.SCENE) {
        //     this.renderer.xr.enabled = true;
        // }

        this.container.appendChild(this.renderer.domElement);
        this.addLighting();
        return this;
    }

    addLighting() {
        // Only add lights if they don't exist already (prevents duplicates on scene->AR transition)
        if (!this.scene.getObjectByName("ambientLight")) {
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
            ambientLight.name = "ambientLight";
            this.scene.add(ambientLight);
        }
        if (!this.scene.getObjectByName("directionalLight")) {
            const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
            directionalLight.name = "directionalLight";
            directionalLight.position.set(5, 10, 5);
            // directionalLight.castShadow = true; // Shadows can be performance intensive in AR
            this.scene.add(directionalLight);
        }
        return this;
    }

    setupResizeObserver() {
        const resizeObserver = new ResizeObserver(() => {
            // Only resize if not presenting AR
            if (this.renderer && !this.renderer.xr.isPresenting) {
                const clientWidth = this.container.clientWidth;
                const clientHeight = this.container.clientHeight;
                if (clientWidth > 0 && clientHeight > 0) {
                    this.camera.aspect = clientWidth / clientHeight;
                    this.camera.updateProjectionMatrix();
                    this.renderer.setSize(clientWidth, clientHeight);
                }
            }
        });
        resizeObserver.observe(this.container);
        return this;
    }

    // Optional: Method to clean up renderer if needed when component is removed
    cleanup() {
        if (this.renderer && this.renderer.domElement && this.renderer.domElement.parentNode) {
            this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
        }
        if (this.renderer) {
            this.renderer.dispose(); // Dispose resources
        }
        this.renderer = null;
        this.scene = null; // Scene might be managed elsewhere, be careful
        this.camera = null;
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
                    // Add model only if scene exists
                    if (this.scene) {
                        this.scene.add(object);
                    } else {
                        console.warn("Scene not available for ModelLoader");
                    }
                    resolve(object);
                },
                undefined, // Progress callback (optional)
                (error) => {
                    console.error(`Error loading model from ${modelSrc}:`, error);
                    reject(error);
                }
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
        return { x: dLon, z: -dLat }; // Assuming Z is North, X is East
    }
}

function setupNativeTouchControls(placedObject, element, options = { rotateEnabled: true, scaleEnabled: true }) {
    console.log('setupNativeTouchControls initiated for:', placedObject.name || 'object');
    let initialTouchDistance = null;
    let initialTouchAngle = null;
    let initialScale = placedObject.scale.clone(); // Clone scale vector
    let initialRotationY = placedObject.rotation.y;

    function getDistance(t1, t2) {
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getAngle(t1, t2) {
        const dx = t2.clientX - t1.clientX;
        const dy = t2.clientY - t1.clientY;
        return Math.atan2(dy, dx);
    }

    // Use unique listener functions to allow removal later if needed
    const touchStartListener = (e) => {
        if (e.touches.length === 2) {
            e.preventDefault(); // Prevent default actions like page zoom
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            initialTouchDistance = getDistance(touch1, touch2);
            initialTouchAngle = getAngle(touch1, touch2);
            initialScale.copy(placedObject.scale); // Store initial scale
            initialRotationY = placedObject.rotation.y; // Store initial Y rotation
            console.log('Touch start (2 fingers)');
        }
    };

    const touchMoveListener = (e) => {
        if (e.touches.length === 2) {
            e.preventDefault(); // Prevent default actions like page scroll/zoom
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            const currentDistance = getDistance(touch1, touch2);
            const currentAngle = getAngle(touch1, touch2);

            if (options.scaleEnabled && initialTouchDistance !== null && initialTouchDistance > 0) {
                const scaleFactor = currentDistance / initialTouchDistance;
                placedObject.scale.copy(initialScale).multiplyScalar(scaleFactor); // Apply scale relative to initial
            }

            if (options.rotateEnabled && initialTouchAngle !== null) {
                const angleDiff = currentAngle - initialTouchAngle;
                placedObject.rotation.y = initialRotationY - angleDiff; // Adjust Y rotation based on angle difference
            }
        }
    };

    const touchEndListener = (e) => {
        // Reset initial values if less than 2 touches remain
        if (e.touches.length < 2) {
            if (initialTouchDistance !== null || initialTouchAngle !== null) {
                console.log('Touch end (less than 2 fingers)');
                initialTouchDistance = null;
                initialTouchAngle = null;
            }
        }
    };

    // Add listeners with passive: false to allow preventDefault
    element.addEventListener("touchstart", touchStartListener, { passive: false });
    element.addEventListener("touchmove", touchMoveListener, { passive: false });
    element.addEventListener("touchend", touchEndListener, { passive: false });

    // Return a cleanup function to remove listeners if the object is removed or controls change
    return () => {
        console.log('Cleaning up touch controls for:', placedObject.name || 'object');
        element.removeEventListener("touchstart", touchStartListener);
        element.removeEventListener("touchmove", touchMoveListener);
        element.removeEventListener("touchend", touchEndListener);
    };
}


class PrimitiveManager {
    constructor(scene) {
        this.scene = scene;
        this.primitives = [];
    }

    createBox(options = {}) {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({
            color: options.color || 0x4CC3D9,
            metalness: options.metalness ?? 0.5, // Use nullish coalescing
            roughness: options.roughness ?? 0.5
        });
        const box = new THREE.Mesh(geometry, material);
        box.name = options.name || `box_${this.primitives.length}`;

        if (options.position) {
            const [x, y, z] = options.position.split(' ').map(Number);
            box.position.set(x, y, z);
        }

        if (options.rotation) {
            const [x, y, z] = options.rotation.split(' ').map(Number);
            box.rotation.set(
                THREE.MathUtils.degToRad(x),
                THREE.MathUtils.degToRad(y),
                THREE.MathUtils.degToRad(z)
            );
        }

        this.scene.add(box);
        this.primitives.push(box);
        return box;
    }

    createSphere(options = {}) {
        const geometry = new THREE.SphereGeometry(options.radius || 1, 32, 16); // Adjusted segments
        const material = new THREE.MeshStandardMaterial({
            color: options.color || 0xEF2D5E,
            metalness: options.metalness ?? 0.5,
            roughness: options.roughness ?? 0.5
        });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.name = options.name || `sphere_${this.primitives.length}`;

        if (options.position) {
            const [x, y, z] = options.position.split(' ').map(Number);
            sphere.position.set(x, y, z);
        }
        // Rotation typically doesn't affect a sphere visually unless textured

        this.scene.add(sphere);
        this.primitives.push(sphere);
        return sphere;
    }

    createCylinder(options = {}) {
        const geometry = new THREE.CylinderGeometry(
            options.radius || 0.5,
            options.radius || 0.5,
            options.height || 1,
            32 // Radial segments
        );
        const material = new THREE.MeshStandardMaterial({
            color: options.color || 0xFFC65D,
            metalness: options.metalness ?? 0.5,
            roughness: options.roughness ?? 0.5
        });
        const cylinder = new THREE.Mesh(geometry, material);
        cylinder.name = options.name || `cylinder_${this.primitives.length}`;

        if (options.position) {
            const [x, y, z] = options.position.split(' ').map(Number);
            cylinder.position.set(x, y, z);
        }

        if (options.rotation) {
            const [x, y, z] = options.rotation.split(' ').map(Number);
            cylinder.rotation.set(
                THREE.MathUtils.degToRad(x),
                THREE.MathUtils.degToRad(y),
                THREE.MathUtils.degToRad(z)
            );
        }

        this.scene.add(cylinder);
        this.primitives.push(cylinder);
        return cylinder;
    }

    createPlane(options = {}) {
        const geometry = new THREE.PlaneGeometry(
            options.width || 1,
            options.height || 1
        );
        const material = new THREE.MeshStandardMaterial({
            color: options.color || 0x7BC8A4,
            metalness: options.metalness ?? 0.5,
            roughness: options.roughness ?? 0.5,
            side: THREE.DoubleSide // Render both sides
        });
        const plane = new THREE.Mesh(geometry, material);
        plane.name = options.name || `plane_${this.primitives.length}`;

        if (options.position) {
            const [x, y, z] = options.position.split(' ').map(Number);
            plane.position.set(x, y, z);
        }

        if (options.rotation) {
            const [x, y, z] = options.rotation.split(' ').map(Number);
            plane.rotation.set(
                THREE.MathUtils.degToRad(x),
                THREE.MathUtils.degToRad(y),
                THREE.MathUtils.degToRad(z)
            );
        }

        this.scene.add(plane);
        this.primitives.push(plane);
        return plane;
    }

    // Optional: Method to remove primitives if needed
    removeAllPrimitives() {
        this.primitives.forEach(primitive => {
            if (!primitive) return;
            if (primitive.geometry) primitive.geometry.dispose();
            if (primitive.material) {
                // Dispose textures if any
                Object.keys(primitive.material).forEach(key => {
                    const value = primitive.material[key];
                    if (value && typeof value.dispose === 'function') {
                        value.dispose();
                    }
                });
                primitive.material.dispose();
            }
            if (this.scene) {
                this.scene.remove(primitive);
            }
        });
        this.primitives = [];
        console.log("Primitives removed and disposed.");
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
        this.container.style.overflow = "hidden"; // Prevent scrollbars
        this.container.style.touchAction = "none"; // Essential for controlling touch events
        this.shadowRoot.appendChild(this.container);

        // DOM Overlay for UI elements in AR
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
        this.domOverlayContainer.style.touchAction = "none";
        this.domOverlayContainer.style.pointerEvents = "none"; // Allow clicks/touches to pass through by default
        this.domOverlayContainer.style.touchAction = "none"; // Prevent default touch actions
        // Child elements within the overlay should set pointerEvents: 'auto' if they need interaction
        this.shadowRoot.appendChild(this.domOverlayContainer);

        // Configuration attributes
        this.rotateEnabled = this.getAttribute("rotate") !== "false";
        this.scaleEnabled = this.getAttribute("scale") !== "false";
        this.positionateEnabled = this.getAttribute("positionate") !== "false"; // For floor/wall placement modes
        this.arEnabled = this.getAttribute("ar-enabled") !== "false"; // For viewer mode AR button
        this.autoGenerateButton = this.getAttribute("auto-button") !== "false";
        this.mode = this.getAttribute("mode") || MODES.VIEWER;

        // State variables
        this.session = null;
        this.sceneManager = null;
        this.modelLoader = null;
        this.primitiveManager = null;
        this.objects = []; // For GPS/Anchors modes
        this.viewerObjects = []; // For Viewer mode
        this.currentObjectIndex = 0; // For Viewer mode carousel
        this.placedObject = null; // For floor/wall placement modes
        this.hitTestSource = null;
        this.sceneModeControls = null; // OrbitControls reference for scene mode
        this.isTransitioningFromScene = false; // Flag for scene -> AR transition
        this.touchControlsCleanup = null; // Function to remove touch listeners

        this.init();
    }

    init() {
        this.setupARButton(); // Setup button listeners first

        // Initialize based on mode
        if (this.mode === MODES.VIEWER) {
            this.initViewerMode();
        } else if (this.mode === MODES.SCENE) {
            this.initSceneMode(); // Initialize the 3D preview
        }
        // AR modes (floor, wall, gps, anchors) initialize their scene via requestWebXRSession -> initScene
    }

    setupARButton() {
        this.userButton = document.querySelector(`[kitcore-webar-button][for="${this.id}"]`) || document.querySelector("[kitcore-webar-button]:not([for])"); // Find specific or general button

        // Create auto-button only if no user button exists, auto-button is enabled, and mode is not viewer
        if (!this.userButton && this.autoGenerateButton && this.mode !== MODES.VIEWER) {
            this.createAutoButton();
        }

        const buttonToListen = this.userButton || this.startButton; // Determine which button to use

        if (buttonToListen) {
            buttonToListen.addEventListener("click", () => {
                if (this.mode === MODES.VIEWER) {
                    // Viewer mode -> Scene Viewer / Quick Look
                    if (!this.arEnabled) {
                        console.warn("AR is disabled for viewer mode.");
                        return;
                    }
                    const currentVisibleObject = this.viewerObjects[this.currentObjectIndex];
                    if (!currentVisibleObject) {
                        console.error("Couldn't find the currently visible object for Scene Viewer.");
                        return;
                    }
                    const modelSrc = currentVisibleObject.src;
                    const usdzSrc = currentVisibleObject.usdz;
                    // src is required for Android, usdz for iOS
                    if (!modelSrc && !usdzSrc) {
                        console.error("Missing 'src' (for Android) or 'usdz' (for iOS) attribute for the current object.");
                        return;
                    }
                    this.openSceneViewer(modelSrc, usdzSrc);
                } else {
                    // Other modes (including scene) -> WebXR session
                    this.requestWebXRSession();
                }
            });
        }
    }

    createAutoButton() {
        // Prevent creating multiple auto-buttons
        if (this.startButton && this.startButton.isConnected) return;

        this.startButton = document.createElement("button");
        this.startButton.innerText = "Start AR";
        this.startButton.style.position = "absolute";
        this.startButton.style.bottom = "20px"; // Position at bottom center
        this.startButton.style.left = "50%";
        this.startButton.style.transform = "translateX(-50%)";
        this.startButton.style.padding = "12px 24px";
        this.startButton.style.fontSize = "16px";
        this.startButton.style.fontWeight = "bold";
        this.startButton.style.background = "#007bff"; // Blue background
        this.startButton.style.color = "white";
        this.startButton.style.border = "none";
        this.startButton.style.borderRadius = "30px"; // Rounded corners
        this.startButton.style.cursor = "pointer";
        this.startButton.style.zIndex = "1001";
        this.startButton.style.boxShadow = "0 4px 8px rgba(0,0,0,0.2)"; // Subtle shadow
        // Append inside the container (part of the component)
        document.body.appendChild(this.startButton);
        // Listener is added in setupARButton
    }

    async requestWebXRSession() {
        if (!navigator.xr) {
            console.error("WebXR is not supported on this device.");
            alert("Your device does not support WebXR.");
            return;
        }
        if (this.session) {
            console.warn("WebXR session already active.");
            return; // Avoid starting multiple sessions
        }

        try {
            console.log(`Attempting to start WebXR in mode: ${this.mode}`);
            if (this.mode === MODES.VIEWER) {
                console.warn(`Mode '${this.mode}' does not use an immersive AR session.`);
                return;
            }

            this.isTransitioningFromScene = (this.mode === MODES.SCENE);

            let sessionInit = {
                requiredFeatures: ["local-floor"], // Basic requirement for world tracking
                optionalFeatures: ["dom-overlay", "hit-test", "plane-detection", "anchors"] // Request features potentially needed by any mode
            };
            // Configure DOM Overlay
            sessionInit.domOverlay = { root: this.domOverlayContainer };


            this.session = await navigator.xr.requestSession("immersive-ar", sessionInit);
            this.domOverlayContainer.style.display = "flex"; // Show overlay container (content visibility managed separately)
            this.domOverlayContainer.style.pointerEvents = 'auto'; // Allow interaction with overlay elements

            console.log("WebXR session requested successfully.");

            // Handle session end event
            this.session.addEventListener('end', () => {
                console.log('WebXR session ended.');
                this.session = null;
                this.hitTestSource = null;
                this.isTransitioningFromScene = false; // Reset flag
                this.domOverlayContainer.style.display = 'none'; // Hide overlay
                this.domOverlayContainer.style.pointerEvents = 'none';
                // Clean up touch controls if they exist
                if (this.touchControlsCleanup) {
                    this.touchControlsCleanup();
                    this.touchControlsCleanup = null;
                }
                // Re-initialize the original mode's non-AR view if needed
                if (this.mode === MODES.SCENE) {
                    this.initSceneMode(); // Re-init scene preview
                } else if (this.mode === MODES.VIEWER) {
                    // Viewer doesn't use immersive, but good practice
                } else {
                    // Other modes might need specific cleanup or re-init logic
                }
                // Show the AR button again if it was removed
                if (this.startButton && !this.startButton.isConnected) {
                    this.container.appendChild(this.startButton);
                }
            });


            // --- Pre-AR Scene Adjustments ---
            if (this.isTransitioningFromScene) {
                // Transitioning from scene preview to AR (showing the same scene)
                if (this.sceneModeControls) {
                    console.log("Disposing OrbitControls for AR session.");
                    this.sceneModeControls.dispose();
                    this.sceneModeControls = null;
                }
                // Ensure scene background is transparent for AR
                if (this.sceneManager && this.sceneManager.scene) {
                    this.sceneManager.scene.background = null;
                }
            } else {
                // Starting AR directly (floor, wall, gps, anchors) - Scene needs creation
                // Handled within initScene
            }
            // --- End Pre-AR Adjustments ---


            this.initScene(); // Initialize/configure the AR scene rendering

            // Hide the AR button after session starts
            if (this.startButton && this.startButton.isConnected) {
                this.startButton.remove();
            }
            if (this.userButton) {
                // Optionally hide the user button too, or manage its state
                // this.userButton.style.display = 'none';
            }


        } catch (error) {
            console.error("Error requesting WebXR session:", error);
            alert(`Failed to activate WebXR: ${error.message}`);
            this.session = null; // Ensure session is null on failure
            this.isTransitioningFromScene = false; // Reset flag
            this.domOverlayContainer.style.display = 'none';
            this.domOverlayContainer.style.pointerEvents = 'none';
        }
    }

    initScene() {
        // This function configures the scene for AR rendering *after* the session has started.

        if (!this.session) {
            console.error("initScene called without an active WebXR session.");
            return;
        }
        if (this.mode === MODES.VIEWER) { return; } // Should not happen

        // Ensure SceneManager exists
        // If transitioning from scene, it already exists. Otherwise, create it.
        if (!this.sceneManager) {
            console.log("Creating SceneManager for AR mode:", this.mode);
            this.sceneManager = new SceneManager(this.container, this.mode)
                // Use session's baseLayer size if available, fallback to window
                .createScene(this.session.renderState.baseLayer?.framebufferWidth || window.innerWidth,
                    this.session.renderState.baseLayer?.framebufferHeight || window.innerHeight)
                .setupResizeObserver(); // Resize observer might not be needed in immersive AR
            // Add camera only if creating the scene here
            this.sceneManager.scene.add(this.sceneManager.camera);
        } else {
            console.log("Using existing SceneManager for AR mode:", this.mode);
        }

        // Ensure ModelLoader exists if needed by the mode
        if (!this.modelLoader && (this.mode === MODES.FLOOR || this.mode === MODES.WALL || this.mode === MODES.GPS || this.mode === MODES.ANCHORS)) {
            this.modelLoader = new ModelLoader(this.sceneManager.scene);
        }

        // --- Mode Specific AR Setup ---
        if (this.isTransitioningFromScene) {
            // Mode: SCENE -> AR (Show existing scene)
            this.domOverlayContainer.innerText = ""; // Clear any previous text
            console.log("Configuring AR to display existing scene content.");
            // No placement logic needed here, scene objects are already positioned relative to origin (0,0,0)
            // which becomes the user's starting position in AR.
        } else if (this.mode === MODES.FLOOR || this.mode === MODES.WALL) {
            // Mode: FLOOR or WALL (Placement)
            this.domOverlayContainer.innerText = this.mode === MODES.WALL ? "Point at a wall" : "Point at the floor";
            this.enablePlacement(); // Setup hit-testing and placement logic
        } else if (this.mode === MODES.GPS) {
            // Mode: GPS
            this.domOverlayContainer.innerText = "Locating GPS objects...";
            this.loadObjects();
            this.enableGPS();
        } else if (this.mode === MODES.ANCHORS) {
            // Mode: ANCHORS
            this.domOverlayContainer.innerText = "Locating anchors...";
            this.loadObjects();
            this.enableAnchors();
        }
        // --- End Mode Specific AR Setup ---

        // Configure the renderer for the XR session
        try {
            this.sceneManager.renderer.xr.enabled = true; // Ensure XR is enabled on the renderer
            this.sceneManager.renderer.xr.setReferenceSpaceType('local-floor'); // Common reference space
            this.sceneManager.renderer.xr.setSession(this.session);
            console.log("Renderer configured for WebXR session.");
        } catch (error) {
            console.error("Error configuring renderer for WebXR:", error);
            alert(`Error setting up renderer: ${error.message}`);
            this.session.end(); // End session if renderer setup fails
            return;
        }


        // --- Setup Render Loop ---
        this.sceneManager.renderer.setAnimationLoop((timestamp, frame) => {
            if (!frame) {
                // Frame can be null if session ends or context is lost
                console.warn("Render loop called without a frame.");
                return;
            }

            // --- Per-Frame Updates ---
            // Hit-test feedback (only relevant for placement modes, but check exists)
            if (this.hitTestSource && (!this.placedObject || !this.placedObject.isPlaced)) {
                this.updateHitTestFeedback(frame);
            }

            // GPS object updates (lookatuser)
            if (this.mode === MODES.GPS) {
                this.updateGPSObjects();
            }

            // Anchor updates (if using anchors mode)
            if (this.mode === MODES.ANCHORS) {
                this.updateAnchors(frame);
            }
            // --- End Per-Frame Updates ---

            // Render the scene using WebXR's camera pose
            if (this.sceneManager && this.sceneManager.renderer && this.sceneManager.scene && this.sceneManager.camera) {
                this.sceneManager.renderer.render(this.sceneManager.scene, this.sceneManager.camera);
            }
        });
        // --- End Render Loop Setup ---
    }

    updateHitTestFeedback(frame) {
        const referenceSpace = this.sceneManager.renderer.xr.getReferenceSpace();
        if (!referenceSpace || !this.hitTestSource) return;

        const hitTestResults = frame.getHitTestResults(this.hitTestSource);

        if (hitTestResults.length > 0) {
            // We have a hit
            // Optional: Show a reticle or visual indicator at hitTestResults[0].getPose(referenceSpace)
            if (this.mode === MODES.WALL) {
                // Optional: Check if vertical
                this.domOverlayContainer.innerText = "Tap to place on surface";
            } else {
                this.domOverlayContainer.innerText = "Tap to place on floor";
            }
        } else {
            // No hit
            this.domOverlayContainer.innerText = this.mode === MODES.WALL ? "Point at a wall" : "Point at the floor";
        }
    }

    updateGPSObjects() {
        // Example: Handle lookatuser for GPS objects
        this.objects.forEach(obj => {
            if (obj.lookatuser && obj.object && obj.object.visible && this.sceneManager.camera) {
                // Make the object look at the camera's position, but potentially keep its Y rotation fixed
                const targetPosition = new THREE.Vector3();
                this.sceneManager.camera.getWorldPosition(targetPosition);
                // Option 1: Full lookAt
                // obj.object.lookAt(targetPosition);
                // Option 2: LookAt only on the horizontal plane (preserves upright orientation)
                targetPosition.y = obj.object.position.y;
                obj.object.lookAt(targetPosition);
            }
        });
    }

    updateAnchors(frame) {
        const referenceSpace = this.sceneManager.renderer.xr.getReferenceSpace();
        if (!referenceSpace || this.currentUserLat === undefined || this.currentUserLon === undefined) return;

        this.objects.forEach((obj) => {
            const detectionRadius = obj.distance || this.getAttribute("distance") || AR_CONFIG.DETECTION_RADIUS;
            const distanceToUser = GeolocationManager.calculateDistance(
                this.currentUserLat, this.currentUserLon, obj.lat, obj.lon
            );

            if (distanceToUser < detectionRadius) {
                if (!obj.anchor && frame.createAnchor) { // Check if createAnchor is supported
                    const { x, z } = GeolocationManager.convertGPSToMeters(
                        obj.lat, obj.lon, this.currentUserLat, this.currentUserLon
                    );
                    const y = obj.altitude;
                    // Use estimated height relative to the floor if altitude is relative
                    // Or use absolute altitude if available and supported
                    const transform = new XRRigidTransform({ x: x, y: y, z: z });

                    frame.createAnchor(transform, referenceSpace)
                        .then((anchor) => {
                            console.log(`Anchor created for object at ${obj.lat}, ${obj.lon}`);
                            obj.anchor = anchor;
                            obj.object.visible = true;
                        })
                        .catch((err) => console.error(`Error creating anchor:`, err));
                } else if (obj.anchor) {
                    const anchorPose = frame.getPose(obj.anchor.anchorSpace, referenceSpace);
                    if (anchorPose) {
                        obj.object.position.copy(anchorPose.transform.position);
                        obj.object.quaternion.copy(anchorPose.transform.orientation);
                        obj.object.visible = true;
                    } else {
                        // Anchor pose lost temporarily
                        // obj.object.visible = false; // Optionally hide
                    }
                }
            } else {
                // Outside detection radius
                obj.object.visible = false;
                if (obj.anchor) {
                    // Anchors don't have a standard 'delete' method in the spec yet.
                    // We just stop tracking/updating it. It might be garbage collected.
                    console.log(`Object at ${obj.lat}, ${obj.lon} out of range, stopping anchor updates.`);
                    obj.anchor = null; // Remove reference
                }
            }

            // Handle lookatuser for anchored objects
            if (obj.lookatuser && obj.object.visible && this.sceneManager.camera) {
                const targetPosition = new THREE.Vector3();
                this.sceneManager.camera.getWorldPosition(targetPosition);
                targetPosition.y = obj.object.position.y; // LookAt on horizontal plane
                obj.object.lookAt(targetPosition);
            }
        });
    }


    loadObjects() { // For GPS/Anchors
        this.querySelectorAll("kitcore-webar-object").forEach((element) => {
            const lat = parseFloat(element.getAttribute("lat"));
            const lon = parseFloat(element.getAttribute("lon"));
            const src = element.getAttribute("src");
            const distance = parseFloat(element.getAttribute("distance")) || null; // Detection radius override
            const altitude = parseFloat(element.getAttribute("altitude")) || AR_CONFIG.MODEL_HEIGHT; // Y position
            const lookatuser = element.getAttribute("lookatuser") === "true";

            // Basic validation
            if (!isNaN(lat) && !isNaN(lon) && src) {
                this.addObject(lat, lon, src, distance, altitude, lookatuser);
            } else {
                console.warn("Skipping object due to missing or invalid lat, lon, or src:", element);
            }
        });
    }

    async addObject(lat, lon, modelSrc, distance, altitude, lookatuser) { // For GPS/Anchors
        if (!this.modelLoader) {
            console.error("ModelLoader not initialized for addObject.");
            return;
        }
        try {
            const object = await this.modelLoader.loadModel(modelSrc, {
                scale: AR_CONFIG.MODEL_SCALE, // Use default scale or make configurable per object
            });
            object.visible = false; // Initially hide
            this.objects.push({ lat, lon, object, distance, altitude, lookatuser, anchor: null });
            console.log(`Object loaded for GPS/Anchor: ${modelSrc}`);
        } catch (error) {
            console.error(`Error loading object ${modelSrc}:`, error);
        }
    }

    enableGPS() {
        if (!navigator.geolocation) {
            console.error("Geolocation is not supported by this browser.");
            this.domOverlayContainer.innerText = "Error: Geolocation not supported.";
            return;
        }

        navigator.geolocation.watchPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;
                if (this.objects.length > 0) {
                    this.domOverlayContainer.innerText = ""; // Clear loading message once position is obtained
                }

                this.objects.forEach(({ lat, lon, object, distance, altitude }) => {
                    const detectionRadius = distance || this.getAttribute("distance") || AR_CONFIG.DETECTION_RADIUS;
                    const distanceToUser = GeolocationManager.calculateDistance(userLat, userLon, lat, lon);

                    if (distanceToUser < detectionRadius) {
                        if (!object.visible) { // Only update position when becoming visible or if needed
                            const { x, z } = GeolocationManager.convertGPSToMeters(lat, lon, userLat, userLon);
                            // Altitude is relative to the user's starting floor level in 'local-floor' space
                            object.position.set(x, altitude, z);
                            object.visible = true;
                            console.log(`Object ${object.name || ''} visible at ${distanceToUser.toFixed(1)}m`);
                        }
                    } else {
                        if (object.visible) {
                            object.visible = false;
                            console.log(`Object ${object.name || ''} hidden (out of range)`);
                        }
                    }
                });
            },
            (error) => {
                console.error("Error obtaining geolocation:", error);
                this.domOverlayContainer.innerText = `Error: ${error.message}`;
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 } // Options for better accuracy
        );
        // Rendering loop in initScene handles lookatuser updates
    }

    enableAnchors() {
        if (!navigator.geolocation) { /* ... error handling ... */ return; }

        navigator.geolocation.watchPosition(
            (position) => {
                this.currentUserLat = position.coords.latitude;
                this.currentUserLon = position.coords.longitude;
                if (this.objects.length > 0 && this.domOverlayContainer.innerText === "Locating anchors...") {
                    this.domOverlayContainer.innerText = ""; // Clear message
                }
            },
            (error) => { /* ... error handling ... */ },
            { enableHighAccuracy: true }
        );
        // Anchor creation/update logic is handled within the main render loop (updateAnchors) in initScene
    }


    enablePlacement() {
        // Used for FLOOR and WALL modes to place a single object
        const objectElem = this.querySelector("kitcore-webar-object");
        if (!objectElem) {
            console.error("Placement mode requires one <kitcore-webar-object> element.");
            this.domOverlayContainer.innerText = "Error: Object definition missing.";
            return;
        }
        const modelSrc = objectElem.getAttribute("src");
        if (!modelSrc) {
            console.error("Attribute 'src' not defined in <kitcore-webar-object>.");
            this.domOverlayContainer.innerText = "Error: Object 'src' missing.";
            return;
        }

        // Ensure modelLoader exists
        if (!this.modelLoader) {
            this.modelLoader = new ModelLoader(this.sceneManager.scene);
        }

        // Load the model to be placed
        this.modelLoader.loadModel(modelSrc)
            .then((loadedObject) => {
                this.placedObject = loadedObject;
                this.placedObject.visible = false; // Hide until placed
                this.placedObject.isPlaced = false; // Track placement status
                console.log("Placement model loaded:", modelSrc);
            })
            .catch(error => {
                console.error("Error loading placement model:", error);
                this.domOverlayContainer.innerText = "Error loading model.";
            });

        // Request hit test source after session is ready
        this.session
            .requestReferenceSpace("viewer")
            .then((viewerSpace) => {
                // Request hit test source based on mode
                const hitTestOptions = {
                    space: viewerSpace,
                    // Use 'plane' for both floor and wall, potentially filter later if needed
                    // entityTypes: this.mode === MODES.WALL ? ["plane"] : ["plane"]
                };
                // If plane detection is supported and desired, could use profile: 'plane'
                // profile: this.mode === MODES.WALL ? 'vertical-plane' : 'horizontal-plane'

                return this.session.requestHitTestSource(hitTestOptions);
            })
            .then((source) => {
                this.hitTestSource = source;
                console.log("Hit test source ready.");
                // Hit test feedback is handled in the main render loop (updateHitTestFeedback)
            })
            .catch(error => {
                console.error("Error setting up hit testing:", error);
                this.domOverlayContainer.innerText = "Error: Could not start AR placement.";
            });

        // Handle placement on 'select' event (tap)
        const selectListener = (event) => {
            // Ensure we are in placement mode and not transitioning from scene
            if (this.isTransitioningFromScene || !this.placedObject || !this.hitTestSource) return;

            const frame = event.frame;
            const referenceSpace = this.sceneManager.renderer.xr.getReferenceSpace();
            if (!referenceSpace) return;

            const hitTestResults = frame.getHitTestResults(this.hitTestSource);

            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(referenceSpace);

                if (pose) {
                    // Place or reposition the object
                    if (!this.placedObject.isPlaced || this.positionateEnabled) {
                        this.placedObject.position.copy(pose.transform.position);
                        // Optional: Align orientation for wall mode (might need adjustments)
                        // if (this.mode === MODES.WALL) {
                        //     this.placedObject.quaternion.copy(pose.transform.orientation);
                        // }
                        this.placedObject.visible = true;


                        // Only set isPlaced to true on the *first* placement
                        // to allow repositioning if positionateEnabled is true
                        if (!this.placedObject.isPlaced) {
                            this.placedObject.isPlaced = true;
                            console.log("Object placed.");
                            // Setup touch controls only *after* the first placement
                            // Ensure previous listeners are cleaned up if any
                            if (this.touchControlsCleanup) this.touchControlsCleanup();
                            this.touchControlsCleanup = setupNativeTouchControls(this.placedObject, this.domOverlayContainer, {
                                rotateEnabled: this.rotateEnabled,
                                scaleEnabled: this.scaleEnabled
                            });
                        } else {
                            console.log("Object repositioned.");
                        }

                        this.domOverlayContainer.innerText = ""; // Clear placement instructions
                    }
                }
            } else {
                console.log("Select event occurred, but no hit test result.");
            }
        };

        this.session.addEventListener("select", selectListener);

        // Store listener removal function for cleanup when session ends
        const removeSelectListener = () => this.session?.removeEventListener("select", selectListener);
        this.session.addEventListener('end', removeSelectListener, { once: true });
    }


    // isVerticalSurface - kept for potential future use with plane filtering
    isVerticalSurface(orientation) {
        const quat = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
        const normal = new THREE.Vector3(0, 0, -1).applyQuaternion(quat); // Assuming Z- is out from plane
        const angleToUp = normal.angleTo(new THREE.Vector3(0, 1, 0));
        // Check if the angle is close to 90 degrees (PI/2 radians)
        const threshold = Math.PI / 6; // Allow 30 degrees deviation
        return Math.abs(angleToUp - Math.PI / 2) < threshold;
    }

    initViewerMode() {
        const objectElements = this.querySelectorAll("kitcore-webar-object");
        if (objectElements.length === 0) {
            console.error("Viewer mode requires at least one <kitcore-webar-object> element.");
            this.container.innerText = "Error: No objects defined for viewer.";
            return;
        }

        // Create scene manager for viewer mode
        this.sceneManager = new SceneManager(this.container, this.mode)
            .createScene(
                this.container.clientWidth || window.innerWidth,
                this.container.clientHeight || window.innerHeight,
                { cameraPosition: { x: 0, y: 1, z: 3 } } // Default camera position
            )
            .setupResizeObserver();

        // Setup orbit controls
        this.controls = new OrbitControls(
            this.sceneManager.camera,
            this.sceneManager.renderer.domElement
        );
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 0.5;
        this.controls.maxDistance = 20;
        this.controls.target.set(0, 0.8, 0); // Adjust target slightly
        this.controls.update();

        // Load all models
        const modelLoader = new ModelLoader(this.sceneManager.scene);
        this.viewerObjects = []; // Reset array

        Promise.all(Array.from(objectElements).map((element, index) => {
            const modelSrc = element.getAttribute("src");
            const usdzSrc = element.getAttribute("usdz");
            const iconSrc = element.getAttribute("icon");
            if (!modelSrc) {
                console.error(`Attribute 'src' missing in <kitcore-webar-object> at index ${index}.`);
                return Promise.resolve(null);
            }
            return modelLoader.loadModel(modelSrc, {
                scale: 1, // Default scale 1 for viewer
                position: { x: 0, y: 0, z: 0 } // Center models
            }).then(model => {
                model.visible = false; // Hide initially
                return { model, icon: iconSrc, visible: false, src: modelSrc, usdz: usdzSrc };
            }).catch(error => {
                console.error(`Error loading viewer model ${modelSrc}:`, error);
                return null;
            });
        })).then(objects => {
            this.viewerObjects = objects.filter(obj => obj !== null); // Filter out loading errors
            if (this.viewerObjects.length > 0) {
                this.viewerObjects[0].model.visible = true; // Show first object
                this.viewerObjects[0].visible = true;
                this.currentObjectIndex = 0;
                this.createCarousel(); // Create carousel if multiple objects
                this.createSceneViewerButton(); // Create AR button (if enabled)
            } else {
                console.error("No valid models loaded for viewer mode.");
                this.container.innerText = "Error: Could not load models.";
            }
        }).catch(error => {
            console.error("Error processing models for viewer:", error);
        });

        // Animation loop for viewer mode
        this.sceneManager.renderer.setAnimationLoop(() => {
            // Only run if not in an active XR session
            if (!this.session && this.controls && this.sceneManager?.renderer) {
                this.controls.update();
                this.sceneManager.renderer.render(
                    this.sceneManager.scene,
                    this.sceneManager.camera
                );
            }
        });
    }

    createCarousel() {
        if (this.viewerObjects.length <= 1) return; // No carousel needed

        // Remove existing carousel if any
        if (this.carousel && this.carousel.isConnected) {
            this.carousel.remove();
        }

        const carousel = document.createElement("div");
        // ... (carousel styling - same as before) ...
        carousel.style.position = "absolute";
        carousel.style.bottom = "20px";
        carousel.style.left = "50%";
        carousel.style.transform = "translateX(-50%)";
        carousel.style.display = "flex";
        carousel.style.gap = "10px";
        carousel.style.padding = "10px";
        carousel.style.background = "rgba(0,0,0,0.5)";
        carousel.style.borderRadius = "20px";
        carousel.style.zIndex = "1000";
        carousel.style.pointerEvents = 'auto'; // Allow clicks on carousel


        this.viewerObjects.forEach((obj, index) => {
            const icon = document.createElement("img");
            icon.src = obj.icon || "https://via.placeholder.com/40/ffffff/000000?text=M"; // Default placeholder
            // ... (icon styling - same as before) ...
            icon.style.width = "40px";
            icon.style.height = "40px";
            icon.style.borderRadius = "50%";
            icon.style.cursor = "pointer";
            icon.style.opacity = obj.visible ? "1" : "0.5";
            icon.style.transition = "opacity 0.3s";
            icon.style.objectFit = "cover";
            icon.alt = `Object ${index + 1}`;


            icon.addEventListener("click", () => {
                if (this.currentObjectIndex === index) return; // No change if clicking current

                // Hide currently visible object
                this.viewerObjects[this.currentObjectIndex].model.visible = false;
                this.viewerObjects[this.currentObjectIndex].visible = false;

                // Show clicked object
                obj.model.visible = true;
                obj.visible = true;
                this.currentObjectIndex = index;
                this.updateCarouselIcons();
                // Update the AR button (if integrated) to reflect the new object
                this.updateSceneViewerButton();
            });

            carousel.appendChild(icon);
        });

        this.container.appendChild(carousel);
        this.carousel = carousel;
    }

    updateCarouselIcons() {
        if (!this.carousel) return;
        const icons = this.carousel.querySelectorAll("img");
        icons.forEach((icon, index) => {
            icon.style.opacity = index === this.currentObjectIndex ? "1" : "0.5";
        });
    }

    createSceneViewerButton() {
        // Creates the integrated "View in AR" button for viewer mode

        // Don't create if AR is disabled or if a custom button exists
        const customButton = document.querySelector(`[kitcore-webar-button][for="${this.id}"]`) || document.querySelector("[kitcore-webar-button]:not([for])");
        if (!this.arEnabled || customButton) {
            return;
        }
        // Remove existing integrated button if any
        const existingIntegrated = this.container.querySelector("[kitcore-webar-integrated-button]");
        if (existingIntegrated) existingIntegrated.remove();


        // Create button container
        this.arButton = document.createElement("div");
        this.arButton.style.position = "absolute";
        this.arButton.style.top = "20px";
        this.arButton.style.right = "20px";
        this.arButton.style.display = "flex";
        this.arButton.style.flexDirection = "column";
        this.arButton.style.alignItems = "center";
        this.arButton.style.cursor = "pointer";
        this.arButton.style.zIndex = "1000";
        this.arButton.style.pointerEvents = 'auto'; // Allow clicks
        this.arButton.setAttribute("kitcore-webar-integrated-button", ""); // Mark as integrated

        // Create image
        const image = document.createElement("img");
        image.src = "https://cdn.glitch.global/fb107cc3-eb61-429f-842c-0f7804a6f140/view-in-ar.png"; // Replace with your icon URL
        image.style.width = "40px";
        image.style.height = "40px";
        image.style.marginBottom = "5px";


        // Create text
        const text = document.createElement("span");
        text.innerText = "View in AR";
        text.style.color = "white"; // Adjust color based on background
        text.style.fontSize = "14px";
        text.style.fontFamily = "Arial, sans-serif";
        text.style.textAlign = "center";
        text.style.textShadow = "0 1px 2px rgba(0,0,0,0.5)"; // Add shadow for readability


        // Add elements to button
        this.arButton.appendChild(image);
        this.arButton.appendChild(text);

        // Add click event (points to the *current* object)
        this.arButton.addEventListener("click", () => {
            const currentObject = this.viewerObjects[this.currentObjectIndex];
            if (currentObject) {
                this.openSceneViewer(currentObject.src, currentObject.usdz);
            } else {
                console.error("Could not open Scene Viewer: Current object data missing.");
            }
        });

        this.container.appendChild(this.arButton);
        this.updateSceneViewerButton(); // Set initial visibility
    }

    updateSceneViewerButton() {
        // Updates the integrated AR button's visibility based on the current object and platform
        const integratedButton = this.container.querySelector("[kitcore-webar-integrated-button]");
        if (!integratedButton) return; // Only manage the integrated button

        const currentObject = this.viewerObjects[this.currentObjectIndex];
        if (!currentObject) {
            integratedButton.style.display = "none"; // Hide if no current object
            return;
        }

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

        // Show button only if AR is enabled AND (it's not iOS OR usdz exists) AND (it's iOS OR src exists)
        const hasRequiredSrc = isIOS ? !!currentObject.usdz : !!currentObject.src;
        const shouldShow = this.arEnabled && hasRequiredSrc;

        integratedButton.style.display = shouldShow ? "flex" : "none";
    }

    openSceneViewer(modelSrc, usdzSrc) {
        // Opens Scene Viewer (Android) or Quick Look (iOS)

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

        if (isIOS) {
            if (!usdzSrc) {
                console.error("Cannot open AR on iOS: 'usdz' attribute is missing for the selected object.");
                alert("AR view requires a USDZ model for this device.");
                return;
            }
            // iOS Quick Look
            const anchor = document.createElement("a");
            anchor.setAttribute("rel", "ar");
            anchor.setAttribute("href", usdzSrc);
            // anchor.appendChild(document.createElement("img")); // Optional: Add image for visual feedback if needed
            anchor.click();
            console.log("Attempting to open Quick Look with:", usdzSrc);
        } else {
            // Android Scene Viewer
            if (!modelSrc) {
                console.error("Cannot open AR on Android: 'src' attribute is missing for the selected object.");
                alert("AR view requires a GLB/GLTF model for this device.");
                return;
            }
            // Construct the Intent URL
            const intent = `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(modelSrc)}&mode=ar_only#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(window.location.href)};end;`;
            // Alternative package: com.google.android.googlequicksearchbox
            // const intent = `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(modelSrc)}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(window.location.href)};end;`;

            window.location.href = intent;
            console.log("Attempting to open Scene Viewer with:", modelSrc);
        }
    }

    initSceneMode() {
        // Initializes the 3D preview for 'scene' mode

        // Ensure previous instances are cleaned up if re-initializing
        if (this.sceneManager) this.sceneManager.cleanup();
        if (this.sceneModeControls) this.sceneModeControls.dispose();

        this.sceneManager = new SceneManager(this.container, this.mode)
            .createScene(this.container.clientWidth || window.innerWidth, this.container.clientHeight || window.innerHeight)
            .setupResizeObserver();

        this.primitiveManager = new PrimitiveManager(this.sceneManager.scene);

        // Camera setup for the preview
        this.sceneManager.camera.position.set(0, 1.5, 6); // Slightly adjusted position
        this.sceneManager.camera.lookAt(0, 0.5, 0); // Look slightly down towards center
        this.sceneManager.scene.add(this.sceneManager.camera);

        // OrbitControls for the preview
        this.sceneModeControls = new OrbitControls(
            this.sceneManager.camera,
            this.sceneManager.renderer.domElement
        );
        this.sceneModeControls.enableDamping = true;
        this.sceneModeControls.dampingFactor = 0.05;
        this.sceneModeControls.screenSpacePanning = false;
        this.sceneModeControls.minDistance = 1;
        this.sceneModeControls.maxDistance = 50;
        this.sceneModeControls.target.set(0, 0.5, 0); // Match camera lookAt
        this.sceneModeControls.update();

        this.createPrimitives(); // Create boxes, spheres, etc. from HTML

        // Animation loop for the 3D preview
        this.sceneManager.renderer.setAnimationLoop(() => {
            // Only run if NOT in an active XR session
            if (!this.session && this.sceneManager?.renderer) { // Check renderer exists
                if (this.sceneModeControls) {
                    this.sceneModeControls.update();
                }
                this.sceneManager.renderer.render(
                    this.sceneManager.scene,
                    this.sceneManager.camera
                );
            }
        });
        console.log("Scene mode initialized (3D Preview).");
    }

    createPrimitives() {
        // Creates primitive objects based on child elements
        if (!this.primitiveManager) {
            console.error("PrimitiveManager not initialized for createPrimitives.");
            return;
        }

        const boxElements = this.querySelectorAll('kitcore-webar-box');
        const sphereElements = this.querySelectorAll('kitcore-webar-sphere');
        const cylinderElements = this.querySelectorAll('kitcore-webar-cylinder');
        const planeElements = this.querySelectorAll('kitcore-webar-plane');

        console.log(`Found ${boxElements.length} boxes, ${sphereElements.length} spheres, ${cylinderElements.length} cylinders, ${planeElements.length} planes.`);

        boxElements.forEach(element => {
            const options = {
                position: element.getAttribute('position'),
                rotation: element.getAttribute('rotation'),
                color: element.getAttribute('color'),
                name: element.id || undefined // Use element ID as name if provided
            };
            this.primitiveManager.createBox(options);
        });

        sphereElements.forEach(element => {
            const options = {
                position: element.getAttribute('position'),
                radius: parseFloat(element.getAttribute('radius')),
                color: element.getAttribute('color'),
                name: element.id || undefined
            };
            this.primitiveManager.createSphere(options);
        });

        cylinderElements.forEach(element => {
            const options = {
                position: element.getAttribute('position'),
                rotation: element.getAttribute('rotation'), // Added rotation for cylinder
                radius: parseFloat(element.getAttribute('radius')),
                height: parseFloat(element.getAttribute('height')),
                color: element.getAttribute('color'),
                name: element.id || undefined
            };
            this.primitiveManager.createCylinder(options);
        });

        planeElements.forEach(element => {
            const options = {
                position: element.getAttribute('position'),
                rotation: element.getAttribute('rotation'),
                width: parseFloat(element.getAttribute('width')),
                height: parseFloat(element.getAttribute('height')),
                color: element.getAttribute('color'),
                name: element.id || undefined
            };
            this.primitiveManager.createPlane(options);
        });
        console.log("Primitives created.");
    }

    // Lifecycle callback for when the element is removed from the DOM
    disconnectedCallback() {
        console.log("KitCoreWebAR element removed from DOM.");
        // End session if active
        if (this.session) {
            this.session.end().catch(e => console.error("Error ending session on disconnect:", e));
            this.session = null;
        }
        // Clean up Three.js resources
        if (this.sceneManager) {
            this.sceneManager.cleanup();
            this.sceneManager = null;
        }
        if (this.primitiveManager) {
            this.primitiveManager.removeAllPrimitives(); // Dispose geometry/materials
            this.primitiveManager = null;
        }
        if (this.sceneModeControls) {
            this.sceneModeControls.dispose();
            this.sceneModeControls = null;
        }
        // Clean up touch controls
        if (this.touchControlsCleanup) {
            this.touchControlsCleanup();
            this.touchControlsCleanup = null;
        }
        // Remove auto-button if it exists and is connected
        if (this.startButton && this.startButton.isConnected) {
            this.startButton.remove();
        }
        // Remove other listeners if necessary (e.g., geolocation watchers)
        // TODO: Add cleanup for geolocation watchers if enableGPS/enableAnchors were used
    }

}

// --- Custom Element Definitions for Primitives ---
// These classes are mainly placeholders for parsing in createPrimitives
class KitCoreWebARBox extends HTMLElement { connectedCallback() { } }
class KitCoreWebARSphere extends HTMLElement { connectedCallback() { } }
class KitCoreWebARCylinder extends HTMLElement { connectedCallback() { } }
class KitCoreWebARPlane extends HTMLElement { connectedCallback() { } }
// Optional: Define for the object element as well
class KitCoreWebARObject extends HTMLElement { connectedCallback() { } }


// --- Register all custom elements ---
customElements.define("kitcore-webar", KitCoreWebAR);
customElements.define("kitcore-webar-box", KitCoreWebARBox);
customElements.define("kitcore-webar-sphere", KitCoreWebARSphere);
customElements.define("kitcore-webar-cylinder", KitCoreWebARCylinder);
customElements.define("kitcore-webar-plane", KitCoreWebARPlane);
customElements.define("kitcore-webar-object", KitCoreWebARObject); // Register object element


// --- Exports ---
export {
    KitCoreWebAR,
    SceneManager,
    ModelLoader,
    GeolocationManager,
    PrimitiveManager, // Export if needed externally
    MODES,
    AR_CONFIG,
};
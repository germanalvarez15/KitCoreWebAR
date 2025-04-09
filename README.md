# KitCore WebAR

KitCore WebAR is a lightweight JavaScript library for integrating WebAR (Web-based Augmented Reality) experiences using the WebXR Device API and Three.js. This library enables developers to create interactive AR experiences with different modes, including surface detection and GPS-based object placement.

##  Documentation & Playground

This repository includes comprehensive documentation and an interactive playground to help you get started with KitCoreWebAR:

- **Documentation**: A detailed guide covering all aspects of the library, from installation to advanced features. The documentation is organized into clear sections with examples and explanations.
- **Playground**: An interactive environment where you can experiment with KitCoreWebAR in real-time. Test different modes, attributes, and features without setting up a full project.

Visit the [KitCore WebAR Docs](https://kitcorewebar-docs.vercel.app/) to explore the full documentation and try out the playground.


## Features

- **Multiple AR Modes:** Supports Viewer, Floor, Wall, and GPS-based placement.
- **WebXR Integration:** Seamless WebXR session management for AR.
- **Three.js Rendering:** Uses Three.js for 3D model rendering.
- **GPS Positioning:** Calculates real-world object placement using latitude and longitude.

## Installation

To use KitCore WebAR, include the library in your project:

```html
<script type="module" src="https://cdn.jsdelivr.net/gh/germanalvarez15/KitCoreWebAR@v0.1.0/KitCoreWebAR-main.js"></script>
```

## Usage

### AR Modes

KitCore WebAR supports the following modes:

#### Viewer Mode

Uses **AR Quick Look** on iOS and **Scene Viewer** on Android. This mode provides a **preliminary 3D viewer** where users can inspect the model before launching the AR experience. On iOS, it opens AR Quick Look for native AR visualization, while on Android, it uses Scene Viewer.

```html
<kitcore-webar mode="viewer">
  <kitcore-webar-object src="model.glb"></kitcore-webar-object>
</kitcore-webar>
```

#### Floor Mode

Places objects on a detected floor surface.

```html
<kitcore-webar mode="floor">
  <kitcore-webar-object src="model.glb"></kitcore-webar-object>
</kitcore-webar>
```

#### Wall Mode

Places objects on a detected vertical surface.

```html
<kitcore-webar mode="wall">
  <kitcore-webar-object src="model.glb"></kitcore-webar-object>
</kitcore-webar>
```

#### GPS Mode

Places objects based on real-world GPS coordinates. Multiple objects can be placed at different positions.

```html
<kitcore-webar mode="gps" distance="10">
  <kitcore-webar-object lat="48.8583701" lon="2.2944813" distance="5" src="eiffel_tower.glb"></kitcore-webar-object>
  <kitcore-webar-object lat="48.8556566" lon="2.3007908" distance="5" src="champ_de_mars.glb"></kitcore-webar-object>
</kitcore-webar>
```

The `distance` attribute in GPS mode determines when an object should become visible based on the user's location:

- `distance="10"` in `<kitcore-webar>` sets the general detection radius for all objects **unless** they define their own `distance`.
- `distance="5"` in `<kitcore-webar-object>` overrides the global detection radius, applying a specific detection range for that object.

### Starting an AR Session

The library automatically generates an AR button, but you can also define a custom button with:

```html
<button kitcore-webar-button>Start AR</button>
```

### Loading a 3D Model

Use the `kitcore-webar-object` element to specify a 3D model:

```html
<kitcore-webar-object src="model.glb"></kitcore-webar-object>
```

## Dependencies

KitCore WebAR relies on:

- [Three.js](https://threejs.org/)
- [WebXR Device API](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API)

## Browser Compatibility

This library requires WebXR support. Compatible browsers include:

- **Chrome** (Android)
- **Firefox** (Experimental WebXR builds)
- **Safari** (Supports AR only via AR Quick Look, as WebXR is not available)

##


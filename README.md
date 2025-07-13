# OpenSeadragon - Flex Renderer

Versatile GPU-accelerated drawer implementation for OpenSeadragon. The design originates from [xOpat viewer](https://github.com/RationAI/xopat), 
where the basis for this rendering engine was developed.

See it in action and get started using it at [https://openseadragon.github.io/][openseadragon].

## Usage

OpenSeadragon v6.0+ is required to use this renderer. It is a drop-in replacement for the default OpenSeadragon drawer, which means you can use it as a regular OpenSeadragon drawer.
Load this renderer after OpenSeadragon and before creating the viewer. It will automatically register itself as a renderer option.

````js
let viewer = OpenSeadragon({
    drawer: 'flex-renderer',
    drawerOptions: {
        'flex-renderer': {
            // optional renderer configuration
            // debug: true
        }
    },
    // other options like id: ...
});
````

Then, you can use one of built-in (or implement custom) visualization styles by
configuring ``TiledImages`` via JSON `shader layers`. The configuration can happen in two ways:
 - handled internally: each Tiled Image will be automatically assigned ``identity`` rendering style,
   which you can customize by calling
   ````js
    viewer.drawer.configureTiledImage(tiledImage, {
        type: 'identity'
    });
   ````
 - handled externally: completely override the renderer output by custom rendering configuration
    ````js
    viewer.drawer.setRenderingConfig({
        'key1': {
            type: 'identity',
            tiledImages: [0],
        },
        'key2': {
            type: 'identity',
            tiledImages: [1],
        },
        'key3': {
            type: 'identity',
            tiledImages: [2],
        }
    }, ['key1', 'key3', 'key2']); // we can define custom layer order for rendering
    ````
In the first case, TiledImage configurations (like blending mode) are respected. In the second case,
the TiledImage settings are **completely overridden** by the provided configuration. That means properties
like `opacity` or `blendMode` are ignored on the TiledImage level, and read only from the provided JSON.

### Shader Layers

Shader layer is a definition of how one or multiple tiled images are rendered. They allow you to
provide custom parameters and customize things like what channels you sample from the data.
Except for the ``type`` property the golden rule is: don't specify what you don't need.

````json
{
  "type": "identity",
  "name": "Probability layer",
  "visible": "1",
  "tiledImages": [0],        // indexes of tiled images to sample from
  "params": {
    // TODO: UI components support in the future
    "use_gamma": 2.0,        //global parameter, apply gamma correction with parameter 2
    "use_channel0": "grab",  //global parameter, identity shader expects 4 channels - we reorder rgba -> grab
    "use_mode": "show",      //global parameter, blend mode context for the layer ("show", "mask", "mask_clip")
    "use_blend": "add",      //global parameter, blend mode for the layer (add, multiply, screen, overlay, etc.)
}
````

### UI Components
When you want to let users to control shader inputs through UI, you need to provide
a handler for rendering the UI components. This handler MUST register the component
UI to DOM when called.

````js
drawerOptions: {
   'flex-renderer':{
      htmlHandler: (shaderLayer, shaderConfig) => {
         const container = document.getElementById('my-shader-ui-container');
         // Create custom layer controls - you can add more HTML controls allowing users to
         // control gamma, blending, or even change the shader type. Here we just show shader layer name + checkbox representing
         // its visibility (but we do not manage change event and thus users cannot change it). In case of error, we show
         // the error message below the checkbox.
         // The compulsory step is to include `shaderLayer.htmlControls()` output.
         container.insertAdjacentHTML('beforeend', 
`<div id="shader-${shaderLayer.id}">
    <input type="checkbox" disabled id="enable-layer-${shaderLayer.id}" ${shaderConfig.visible ? 'checked' : ''}><span>${shaderConfig.name || shaderConfig.type}</span>
    <div>${shaderLayer.error || ""}</div>
    ${shaderLayer.htmlControls()}
</div>`);
      }, 
      htmlReset: () => {
         const container = document.getElementById('my-shader-ui-container');
         container.innerHTML = '';
      }
   }
}
````

UI Components are named arbitrarily (note the reserved `use_` prefix for global parameters though).
They can be configured like so:
````js
{
   type: 'heatmap',
   params: {
       'color': '#ff0000', // color to use for the heatmap
   }        
}
````
Or:
````js
{
   type: 'colormap',
   params: {
       'color': {
           'type': 'color',
           'default': '#ff0000'
           // .. and other properties - depends on the target control type
       }
   }        
}
````

Note that the name of the control in params depends on the shader layer.
Shader layer defines ``color`` as a name for UI control:

````js
 static get defaultControls() {
            return {
                use_channel0: {  // eslint-disable-line camelcase
                    default: "a"
                },
                color: {
                    default: {type: "color", default: "#fff700", title: "Color: "},
                    accepts: (type, instance) => type === "vec3",
                },
    ...
````
But since it does not hardcode any specific properties (missing `required` property map),
we can provide any values we want (including type change) as long as we pass the ``accepts`` check,
which in this case verifies the control outputs ``vec3`` type.


### Demo Playground
Once dev dependencies are installed, you can run the demo playground to see the renderer in action:
```bash
npm run dev
```
and open http://localhost:8000/test/demo/flex-renderer.html in your browser.

## Roadmap
 - Bugfixing & getting ready for the first release
   - Known bug: navigator does not reflect properly rendering changes every time
   - Fixing tests: inherited from OpenSeadragon, they expect incompatible behavior
   - Fixing coverage tests
 - Adding support for WebGL 1.0 (fallback)
 - Modularize ShaderLayers
   - Implement modules (sample color, apply gaussian...) to connect together to create a ShaderLayer. 
 - Add support for concave clipping polygons.
 - Adding support for better debugging & cropping
   - For now, only convex polygons are supported
 - Dynamic documentation that parses available shaders, controls, and shows what can be used where. 

#### What will not be supported
 - Tainted Data. The purpose of this renderer is to draw advanced visualizations on GPU: if your
data is not GPU-accessible, fix your data.

## Development

If you want to use OpenSeadragon in your own projects, you can find the latest stable build, API documentation, and example code at [https://openseadragon.github.io/][openseadragon]. If you want to modify OpenSeadragon and/or contribute to its development, read the [contributing guide][github-contributing] for instructions.

## License

OpenSeadragon is released under the New BSD license. For details, see the [LICENSE.txt file][github-license].

[openseadragon]: https://openseadragon.github.io/
[github-releases]: https://github.com/openseadragon/flex-render/releases
[github-contributing]: https://github.com/openseadragon/flex-render/blob/master/CONTRIBUTING.md
[github-license]: https://github.com/openseadragon/flex-render/blob/master/LICENSE.txt

## Sponsors

We are grateful for the (development or financial) contribution to the OpenSeadragon project.

<a href="https://www.bbmri-eric.eu"><img alt="BBMRI ERIC Logo" src="assets/logos/bbmri-logo.png" height="70" /></a>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;

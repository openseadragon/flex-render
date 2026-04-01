1. ShaderLayer 101 – what a layer actually is

A ShaderLayer is a little bundle of:

Static metadata – name, description, sources (channel expectations), default controls.

Instance config – which tiled images to use, what the user set in use_* controls.

GLSL snippets – definitions + fragment shader “main body” for the second pass.

Helpers – sampleChannel, filter, getTextureSize, etc.

The class lives in flex-shader-layer.js as $.FlexRenderer.ShaderLayer.

When Flex builds the second pass:

It calls your static methods (name(), sources(), defaultControls).

It instantiates layers with a shaderConfig (your JSON config, including tiledImages).

Each layer’s construct() runs:

resetChannel → fills this.__channels from use_channelX options.

resetMode, resetFilters, _buildControls.

At GLSL build time it calls:

getFragmentShaderDefinition() → everything outside main (uniforms, helpers, etc.).

getFragmentShaderExecution() → the body that produces a vec4.

Inside your execution code you are supposed to only sample via this.sampleChannel(...), not manually texture(...).

2. Static API you must implement
   2.1. static name() and static description()
   static name() { return "my_edge_shader"; }

static description() {
return "Sobel edge detection on a multi-channel TIFF.";
}

Just used for UI / debugging.

2.2. static sources()

This describes what each “source slot” expects per sample, independent of how many physical channels the TiledImage has.

The typedef looks like:

/**
* @typedef channelSettings
* @type {Object}
* @property {Function} acceptsChannelCount
* @property {String} description
  */

And the method:

static sources() {
throw "ShaderLayer::sources() must be implemented!";
}

Example (your snippet):

static sources() {
return [{
acceptsChannelCount: (n) => n === 3,
description: "Data to detect edges on"
}];
}

What actually happens:

When the layer is constructed, resetChannel() runs.

It builds this.__channels from use_channel0, use_channel1, … using parseChannel(...).

parseChannel does:

const channelPattern = /[rgba]{1,4}/;

// resolves a channel string (e.g. "r", "rgba", "bg") from options/defaults
// …

// Then checks:
if (!sourceDef.acceptsChannelCount(channel.length)) {
// warn & fall back to default / stacked pattern
}

So acceptsChannelCount(x) only sees the length of the use_channelX string (1–4); it does not inspect the underlying image or pack count. It answers “does this shader make sense if I return a vecX from sampleChannel for this source?”

✅ YES: your new flexible multi-channel backend does not break this.
It still works exactly as before: it validates the vector size you want per sample (float/vec2/vec3/vec4).

If you make a shader that needs 3 components per sample (e.g. RGB for edge detection), then:

static sources() {
return [{
acceptsChannelCount: (n) => n === 3,
description: "Edge input (RGB vec3)"
}];
}

is still correct.

⚠️ It does not automatically verify that the TiledImage actually has ≥3 physical channels; that’s a separate concern (see §6).

2.3. static get defaultControls()

This describes your UI + defaults (including use_channelX).

Example:

static get defaultControls() {
return {
// Built-in opacity control:
// (Flex extends this automatically if you don’t specify it)
opacity: {
default: { type: "range", default: 1, min: 0, max: 1, step: 0.1, title: "Opacity:" },
accepts: (type) => type === "float"
},

        // Channel selection for source #0:
        use_channel0: {
            default: "rgb",  // user can change to e.g. "bgr", "g"
            required: null   // or "rg" to force 2 components
        },

        // Optional channel offset, in case your image carries more than 4 channels
        // and your shader can only consume a subset:
        use_channel_base0: 0,

        // Filters:
        use_gamma: {
            default: 1.0
        },
        use_exposure: {
            default: 0.0
        }
    };
}

Flex then:

Reads / stores these in its internal settings.

Exposes them to your controls UI (this._customControls etc.).

Runs resetChannel, resetFilters, resetMode using them.

3. Instance-side API for shader code
   3.1. getFragmentShaderExecution()

You override this to produce the body of your fragment shader. It must return GLSL that evaluates to a vec4.

You must use this.sampleChannel() (and this.filter()) instead of writing texture(...) yourself.

Example:

getFragmentShaderExecution() {
const uv = "v_texture_coords";

    // Single source, use default use_channel0 (e.g. "rgb")
    const rgb = this.sampleChannel(uv, 0); // returns GLSL expr → vec3 or vec4

    const edge = `vec3(
        abs(dFdx(${rgb}.r)) + abs(dFdy(${rgb}.r)),
        abs(dFdx(${rgb}.g)) + abs(dFdy(${rgb}.g)),
        abs(dFdx(${rgb}.b)) + abs(dFdy(${rgb}.b))
    )`;

    return `
        vec3 color = ${edge};
        return vec4(color, 1.0);
    `;
}
3.2. getFragmentShaderDefinition()

Optional override for helper functions; by default it concatenates GLSL snippets from your controls (so uniforms/functions for sliders etc. appear here).

getFragmentShaderDefinition() {
const base = super.getFragmentShaderDefinition();
return `
${base}

        float myHelper(float x) {
            return x * x;
        }
    `;
}
3.3. sampleChannel(textureCoords, sourceIndex = 0, raw = false)

Current implementation (in your code right now):

sampleChannel(textureCoords, otherDataIndex = 0, raw = false) {
const chan = this.__channels[otherDataIndex];  // from use_channelN
let sampled = `${this.webglContext.sampleTexture(otherDataIndex, textureCoords)}.${chan}`;

    if (raw) {
        return sampled;
    }
    return this.filter(sampled);
}

otherDataIndex is the index into config.tiledImages for this ShaderLayer.

Under WebGL2, this.webglContext.sampleTexture(i, uv) is osd_texture(i, packIndex=0, uv), which samples pack 0 for the chosen TiledImage.

chan is the use_channelN pattern ("r", "rg", "rgba", "bg", …).

Return value:

float if chan.length==1

vec2 / vec3 / vec4 for length 2/3/4.

So today:

sampleChannel(uv, 0) → “some swizzle of the first pack’s RGBA for source #0”.

The sources() acceptsChannelCount(n) checks only chan.length and ensures you don’t accidentally ask for a vec3 when your shader expects a float, etc.

🔴 It does not yet use osd_channel to reach channels beyond the first 4. That’s the extension we discussed earlier.

3.4. filter(glslScalarExpr)

This applies the configured filters (use_gamma, use_exposure, use_logscale, etc.) to a scalar expression.

Very roughly:

const filtered = this.filter("raw_value");

returns something like:

float filteredValue = logScale(exposure(gamma(raw_value)));

(Exact composition depends on your implementation, but logically it’s that.)

You probably want:

const val = this.sampleChannel("v_texCoord", 0);          // scalar
const valFiltered = this.filter(val);                     // scalar with filters
3.5. getTextureSize(sourceIndex = 0)

This surfaces textureSize in GLSL form:

getTextureSize(otherDataIndex = 0) {
return this.webglContext.getTextureSize(otherDataIndex);
}

Under WebGL2 that becomes something like:

ivec2 size = textureSize(u_inputTextures, 0).xy; // fixed lod 0

Useful when you want pixel-space derivatives, etc.

4. Multiple tiled images per shader

Your pipeline does support multiple TIs per shader.

4.1. Configuration

In your shader config (passed to overrideConfigureAll):

const myShaderConfig = {
tiledImages: [0, 3, 2, 1], // indices into viewer.world
// controls:
use_channel0: "r",    // for source 0 (world item 0)
use_channel1: "g",    // for source 1 (world item 3)
use_channel2: "b",
use_channel3: "a"
};

tiledImages[0] = 0 → sourceIndex 0 samples world item 0.

tiledImages[1] = 3 → sourceIndex 1 samples world item 3.

etc. (you can have permutations, subsets, duplicates).

In getFragmentShaderExecution():

const uv = "v_texture_coords";

const src0 = this.sampleChannel(uv, 0);   // from world item 0
const src1 = this.sampleChannel(uv, 1);   // from world item 3

// Do something:
return `
    float a = ${src0};
    float b = ${src1};
    float m = max(a, b);
    return vec4(vec3(m), 1.0);
`;

Under the hood:

During second pass, Flex uploads u_instanceTextureIndexes per layer.

osd_texture(sourceIndex, packIndex, uv) resolves to the correct world item and offscreen layer via u_tiInfo.

So multiple TIs per shader are fully supported.

⚠️ In the internal mode (no overrideConfigureAll), tiledImageCreated wraps config.tiledImages so each shader sees only [thisTiledImageIndex]. So multi-TI per shader is for external configs.

# Flex Renderer Shader Configurator README

This README documents the current **shader configurator** for the `OpenSeadragon.FlexRenderer` API.

It covers:

1. extracting shader API docs as **JSON** or **text**
2. building a **static docs page**
3. building an **interactive configurator**
4. attaching optional **live preview rendering**
5. attaching stable **shader preview images** without brittle remote URLs or large base64 PNG/JPEG blobs

---

## Public API

```js
OpenSeadragon.FlexRenderer.ShaderConfigurator = {
  setUniqueId(id) {},
  setData(data) {},

  setPreviewAssetBasePath(path) {},
  registerShaderPreview(shaderType, preview) {},
  registerShaderPreviewAlias(shaderType, fileName) {},
  setPreviewAdapter(adapter) {},

  registerInteractiveRenderer(type, renderer) {},
  registerDocsRenderer(kind, renderer) {},

  compileDocsModel() {},
  serializeDocs(mode = "json", model = undefined) {},
  renderDocsPage(nodeOrId, model = undefined) {},
  buildShadersAndControlsDocs(nodeOrId) {},

  runShaderSelector(nodeOrId, onFinish) {},
  runShaderAndControlSelector(nodeOrId, onFinish) {},
  runControlSelector(nodeOrId, shaderType, onFinish) {},

  getCurrentShaderConfig() {},
  destroy() {}
};
```

Serialization supports:

- `"json"`
- `"text"`

---

## What changed in the updated configurator

### Docs collapse behavior

Shader docs now render with native HTML `details/summary` blocks for the main shader cards.
That makes collapse/expand behavior much more robust than relying on framework-specific collapse markup.

### Safer preview sizing

The preview session no longer assumes render data always has `width` and `height`.
If no renderable data is present, the configurator falls back to a safe default preview size.

### Stable shader preview images

The configurator now supports local preview image assets through:

- `setPreviewAssetBasePath(path)`
- `registerShaderPreview(shaderType, preview)`
- `registerShaderPreviewAlias(shaderType, fileName)`

This lets you keep previews stable and local instead of depending on remote GitHub links.

### Fallback previews

If no preview image is available for a shader, the configurator can render a lightweight inline SVG fallback.
That keeps the UI stable without embedding large base64 PNG/JPEG payloads in the source.

---

## Extract shader API docs as JSON or text

### Example: JSON

```js
ShaderConfigurator.setUniqueId("my_shader_docs");

const model = ShaderConfigurator.compileDocsModel();
const json = ShaderConfigurator.serializeDocs("json", model);

console.log(json);
```

### Example: text

```js
const model = ShaderConfigurator.compileDocsModel();
const text = ShaderConfigurator.serializeDocs("text", model);

console.log(text);
```

### Example: download JSON

```js
const model = ShaderConfigurator.compileDocsModel();
const json = ShaderConfigurator.serializeDocs("json", model);

const blob = new Blob([json], { type: "application/json" });
const url = URL.createObjectURL(blob);

const a = document.createElement("a");
a.href = url;
a.download = "flex-renderer-shader-api.json";
a.click();

URL.revokeObjectURL(url);
```

### Example: download text

```js
const model = ShaderConfigurator.compileDocsModel();
const text = ShaderConfigurator.serializeDocs("text", model);

const blob = new Blob([text], { type: "text/plain" });
const url = URL.createObjectURL(blob);

const a = document.createElement("a");
a.href = url;
a.download = "flex-renderer-shader-api.txt";
a.click();

URL.revokeObjectURL(url);
```

---

## Build a static docs page

### Minimal usage

```html
<div id="shader-docs"></div>
<script>
  const model = ShaderConfigurator.compileDocsModel();
  ShaderConfigurator.renderDocsPage("shader-docs", model);
</script>
```

### One-liner convenience usage

```js
ShaderConfigurator.buildShadersAndControlsDocs("shader-docs");
```

### Optional: custom docs renderer

If you want to override the default page generator for each shader card:

```js
ShaderConfigurator.registerDocsRenderer("shader", ({ shader }) => {
  const article = document.createElement("article");
  article.className = "card bg-base-100 border border-base-300 shadow-sm";
  article.innerHTML = `
    <div class="card-body">
      <h3 class="card-title">${shader.name}</h3>
      <div class="badge badge-outline">${shader.type}</div>
      <p>${shader.description || ""}</p>
      <pre class="text-xs">${JSON.stringify(shader.controls, null, 2)}</pre>
    </div>
  `;
  return article;
});

const model = ShaderConfigurator.compileDocsModel();
ShaderConfigurator.renderDocsPage("shader-docs", model);
```

### Example page shell with DaisyUI-friendly markup

```html
<div class="container mx-auto p-6">
  <div class="mb-4">
    <h1 class="text-2xl font-bold">Flex Renderer Shader Docs</h1>
    <p class="opacity-80">Generated from ShaderMediator and UIControls.</p>
  </div>

  <div id="shader-docs"></div>
</div>

<script>
  const model = ShaderConfigurator.compileDocsModel();
  ShaderConfigurator.renderDocsPage("shader-docs", model);
</script>
```

---

## Build an interactive configurator

### Minimal interactive configurator

```html
<div id="shader-config-ui"></div>
<script>
  ShaderConfigurator.runControlSelector(
    "shader-config-ui",
    "adaptive_threshold",
    (config) => {
      console.log("Final shader config:", config);
    }
  );
</script>
```

### With image data for preview

```js
const image = new Image();
image.onload = () => {
  ShaderConfigurator.setData(image);
  ShaderConfigurator.runControlSelector(
    "shader-config-ui",
    "adaptive_threshold",
    (config) => {
      console.log("Configured shader:", config);
    }
  );
};
image.src = "/path/to/example.png";
```

### With shader picker first

```js
ShaderConfigurator.runShaderAndControlSelector(
  "shader-config-ui",
  (config) => {
    console.log("Selected and configured:", config);
  }
);
```

### Read current config at any time

```js
const current = ShaderConfigurator.getCurrentShaderConfig();
console.log(current);
```

---

## Stable shader preview images

The recommended approach is to keep shader previews as regular checked-in image files inside your project and let the configurator resolve them locally.

### Configure a local preview asset directory

```js
ShaderConfigurator.setPreviewAssetBasePath("/modules/webgl/shaders");
```

If you load `configurator.js` from a stable package location, the configurator can also infer a default `shaders/` sibling directory automatically.

### Register an explicit image per shader

```js
ShaderConfigurator.registerShaderPreview("heatmap", {
  file: "heatmap.png",
  alt: "Heatmap shader preview"
});
```

### Register an alias only

```js
ShaderConfigurator.registerShaderPreviewAlias("identity", "identity.png");
ShaderConfigurator.registerShaderPreviewAlias("edge", "edge.png");
```

### Register an inline SVG preview

This is useful when you want a tiny stable preview without shipping a raster file.

```js
ShaderConfigurator.registerShaderPreview("custom_shader", {
  svg: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90">
      <rect width="160" height="90" fill="#111827"/>
      <circle cx="45" cy="45" r="24" fill="#60a5fa"/>
      <rect x="85" y="22" width="42" height="46" rx="8" fill="#f59e0b"/>
    </svg>
  `,
  alt: "Custom shader preview"
});
```

### Supported preview definitions

The `preview` value can be:

- a string source
- `{ file: "..." }`
- `{ src: "..." }`
- `{ svg: "..." }`
- a function returning one of the above

Examples:

```js
ShaderConfigurator.registerShaderPreview("code", "code.png");
```

```js
ShaderConfigurator.registerShaderPreview("colormap", {
  src: "/static/previews/colormap.png",
  alt: "Colormap preview"
});
```

```js
ShaderConfigurator.registerShaderPreview("bipolar-heatmap", ({ type, name }) => ({
  file: `${type}.png`,
  alt: `${name} preview`
}));
```

### Recommended strategy

For stable production behavior:

- keep raster previews as local project assets
- use `setPreviewAssetBasePath(...)` once
- use `registerShaderPreviewAlias(...)` for common shader-to-file mappings
- use inline SVG only as a lightweight fallback
- avoid remote GitHub/raw image URLs for runtime UI
- avoid large base64 PNG/JPEG strings in the JS bundle

---

## Register custom simple editors

The configurator should not depend on a hard-coded global `uiRenderers` map.
Register editors explicitly.

### Example: bool editor

```js
ShaderConfigurator.registerInteractiveRenderer("bool", ({ mount, controlConfig, update }) => {
  const label = document.createElement("label");
  label.className = "label cursor-pointer justify-start gap-3";
  label.innerHTML = `
    <input type="checkbox" class="toggle toggle-sm" ${controlConfig.default ? "checked" : ""}>
    <span class="label-text">Default enabled</span>
  `;

  label.querySelector("input").addEventListener("change", (e) => {
    update({ default: !!e.target.checked });
  });

  mount.appendChild(label);
});
```

### Example: `select_int` editor

```js
ShaderConfigurator.registerInteractiveRenderer("select_int", ({ mount, controlConfig, update }) => {
  const options = Array.isArray(controlConfig.options) ? controlConfig.options : [];

  const wrap = document.createElement("div");
  wrap.className = "flex flex-col gap-2";
  wrap.innerHTML = `
    <label class="form-control">
      <div class="label"><span class="label-text">Default</span></div>
      <input class="input input-bordered input-sm" type="number" value="${controlConfig.default ?? 0}">
    </label>
    <textarea class="textarea textarea-bordered h-28 font-mono text-xs">${JSON.stringify(options, null, 2)}</textarea>
  `;

  const defaultInput = wrap.querySelector("input");
  const optionsArea = wrap.querySelector("textarea");

  defaultInput.addEventListener("change", () => {
    update({ default: Number(defaultInput.value) });
  });

  optionsArea.addEventListener("change", () => {
    update({ options: JSON.parse(optionsArea.value) });
  });

  mount.appendChild(wrap);
});
```

---

## How renderer-native controls are mounted

The interactive configurator lets **FlexRenderer** create and initialize its own controls.

The important lifecycle is:

1. create renderer
2. create shader layer
3. set shader order
4. rebuild/register second-pass program
5. call `useProgram(..., "second-pass")`
6. let `htmlHandler(...)` create DOM containers
7. let shader controls initialize themselves via `shader.init()`

### Minimal renderer session example

```js
const renderer = new OpenSeadragon.FlexRenderer({
  uniqueId: "cfg_preview",
  webGLPreferredVersion: "2.0",
  interactive: true,
  debug: false,
  redrawCallback: () => {},
  refetchCallback: () => {},
  htmlHandler: (shaderLayer, shaderConfig) => {
    const mount = document.getElementById("native-controls");
    const id = `controls_${shaderLayer.id}`;

    const section = document.createElement("div");
    section.innerHTML = `<div id="${id}"></div>`;
    mount.appendChild(section);

    return id;
  },
  htmlReset: () => {
    document.getElementById("native-controls").innerHTML = "";
  },
  canvasOptions: {
    stencil: true
  }
});

renderer.setDataBlendingEnabled(true);
renderer.setDimensions(0, 0, 256, 256, 1, 1);

renderer.deleteShaders();
renderer.createShaderLayer("preview_layer", {
  id: "preview_layer",
  name: "Preview",
  type: "adaptive_threshold",
  visible: 1,
  fixed: false,
  tiledImages: [0],
  params: {},
  cache: {}
}, true);

renderer.setShaderLayerOrder(["preview_layer"]);
renderer.registerProgram(null, renderer.webglContext.secondPassProgramKey);
renderer.useProgram(renderer.getProgram(renderer.webglContext.secondPassProgramKey), "second-pass");

document.getElementById("preview-host").appendChild(renderer.canvas);
```

---

## Optional preview adapter

The configurator treats live rendering preview as optional.
That keeps docs/config UI independent from image upload and rendering logistics.

### Expected adapter shape

```js
ShaderConfigurator.setPreviewAdapter({
  async render({ configurator, session, shaderConfig, data }) {
    // optional
  }
});
```

### Minimal no-op adapter

```js
ShaderConfigurator.setPreviewAdapter({
  async render({ session }) {
    session.renderer.canvas.title = "Preview adapter attached";
  }
});
```

### Example shape for a standalone-based adapter

```js
ShaderConfigurator.setPreviewAdapter({
  async render({ configurator, session, shaderConfig, data }) {
    if (!data) return;

    // Typical future flow:
    // 1. upload source using drawer/standalone helper
    // 2. build first-pass package
    // 3. run firstPassProcessData(...)
    // 4. run secondPassProcessData(...)
    // 5. draw renderer canvas into preview host or extract pixels
  }
});
```

---

## Example: full page wiring

```html
<div class="container mx-auto p-6 space-y-6">
  <section>
    <h2 class="text-xl font-bold mb-3">Static docs</h2>
    <div id="shader-docs"></div>
  </section>

  <section>
    <h2 class="text-xl font-bold mb-3">Interactive configurator</h2>
    <div id="shader-config-ui"></div>
  </section>
</div>
```

```js
ShaderConfigurator.setUniqueId("demo_shader_configurator");
ShaderConfigurator.setPreviewAssetBasePath("/modules/webgl/shaders");

// Optional preview data
const img = new Image();
img.onload = async () => {
  ShaderConfigurator.setData(img);

  const model = ShaderConfigurator.compileDocsModel();
  ShaderConfigurator.renderDocsPage("shader-docs", model);

  await ShaderConfigurator.runControlSelector(
    "shader-config-ui",
    "adaptive_threshold",
    (config) => {
      console.log("Done:", config);
    }
  );
};
img.src = "/path/to/example.png";
```

---

## Notes for integration inside the FlexRenderer package

If you place the configurator into the FlexRenderer package, keep these boundaries:

- **Configurator core**
    - metadata compilation
    - docs serialization
    - docs rendering
    - interactive meta-editors
    - preview asset resolution

- **Renderer session**
    - one `FlexRenderer` instance
    - one current shader layer
    - one current DOM mount for native controls

- **Preview adapter**
    - optional
    - can depend on standalone or drawer helpers
    - should stay replaceable

That way:

- docs can be used by browsers, docs pages, and export tooling
- UI can be themed or replaced
- preview can evolve independently of docs/config logic
- shader preview images stay local and stable

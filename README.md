# Workercom

Workercom makes [WebWorkers][webworker] enjoyable. Workercom is a **tiny library (1.1kB)**, that removes the mental barrier of thinking about `postMessage` and hides the fact that you are working with workers. Rewritten and improved communication issues from [Comlink](https://npmjs.org/package/comlink)

At a more abstract level it is an RPC implementation for `postMessage` and [ES6 Proxies][es6 proxy].

```
$ yarn add workercom
```

## Notable difference with [Comlink](https://npmjs.org/package/comlink)

* Remove unnecessary `Comlink.proxy` function (Workercom will find functions, transfering and hydrate them)
* Allows callbacks to be nested within objects
* Allows the proto object to refer back to itself
* ***Default conversion support for [`function`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function?retiredLocale=vi), [`class`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes?retiredLocale=vi), [`Error`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error?retiredLocale=vi) family, [`TypedArray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray) family*** and [OTHER](./structured-clone-table.md)

## Browsers support & bundle size

![Chrome 56+](https://img.shields.io/badge/Chrome-56+-green.svg?style=flat-square)
![Edge 15+](https://img.shields.io/badge/Edge-15+-green.svg?style=flat-square)
![Firefox 52+](https://img.shields.io/badge/Firefox-52+-green.svg?style=flat-square)
![Opera 43+](https://img.shields.io/badge/Opera-43+-green.svg?style=flat-square)
![Safari 10.1+](https://img.shields.io/badge/Safari-10.1+-green.svg?style=flat-square)
![Samsung Internet 6.0+](https://img.shields.io/badge/Samsung_Internet-6.0+-green.svg?style=flat-square)

Browsers without [ES6 Proxy] support can use the [proxy-polyfill].

**Size**: ~2.5k, ~1.2k gzip’d, ~1.1k brotli’d

## Introduction

On mobile phones, and especially on low-end mobile phones, it is important to keep the main thread as idle as possible so it can respond to user interactions quickly and provide a jank-free experience. **The UI thread ought to be for UI work only**. WebWorkers are a web API that allow you to run code in a separate thread. To communicate with another thread, WebWorkers offer the `postMessage` API. You can send JavaScript objects as messages using `myWorker.postMessage(someObject)`, triggering a `message` event inside the worker.

Workercom turns this messaged-based API into a something more developer-friendly by providing an RPC implementation: Values from one thread can be used within the other thread (and vice versa) just like local values.

## Examples

**main.js**

```ts
import { wrap } from "workercom";
import Worker from "worker-loader!./worker.js";

async function init() {
  const worker = new Worker();
  // WebWorkers use `postMessage` and therefore work with Workercom.
  const obj = wrap(worker);
  alert(`Counter: ${await obj.counter}`);
  await obj.inc();
  alert(`Counter: ${await obj.counter}`);
}
init();
```

**worker.js**

```javascript
import { expose } from "workercom";

const obj = {
  counter: 0,
  inc() {
    this.counter++;
  },
};

expose(obj);
```

### Callbacks

**main.js**

```javascript
import { wrap } from "workercom";
import Worker from "worker-loader!./worker.js";

async function init() {
  const remoteFunction = wrap(new Worker());
  await remoteFunction(callback(value) {
    alert(`Result: ${value}`);
  });
}
init();
```

**worker.js**

```javascript
import { expose } from "workercom";

async function remoteFunction(cb) {
  await cb("A string from a worker");
}

expose(remoteFunction);
```

### [`SharedWorker`](./docs/examples/07-sharedworker-example)

When using Workercom with a [`SharedWorker`](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker) you have to:

1. Use the [`port`](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker/port) property, of the `SharedWorker` instance, when calling `Workercom.wrap`.
2. Call `Workercom.expose` within the [`onconnect`](https://developer.mozilla.org/en-US/docs/Web/API/SharedWorkerGlobalScope/onconnect) callback of the shared worker.

**Pro tip:** You can access DevTools for any shared worker currently running in Chrome by going to: **chrome://inspect/#workers**

**main.js**

```javascript
import { wrap } from "workercom";
import SharedWorker from "worker-loader?worker=SharedWorker!./worker.js";

async function init() {
  const worker = new SharedWorker();
  /**
   * SharedWorkers communicate via the `postMessage` function in their `port` property.
   * Therefore you must use the SharedWorker's `port` property when calling `Workercom.wrap`.
   */
  const obj = wrap(worker.port);
  alert(`Counter: ${await obj.counter}`);
  await obj.inc();
  alert(`Counter: ${await obj.counter}`);
}
init();
```

**worker.js**

```javascript
import { expose } from "workercom";

const obj = {
  counter: 0,
  inc() {
    this.counter++;
  },
};

/**
 * When a connection is made into this shared worker, expose `obj`
 * via the connection `port`.
 */
onconnect = function (event) {
  const port = event.ports[0];

  expose(obj, port);
};

// Single line alternative:
// onconnect = (e) => expose(obj, e.ports[0]);
```

## API

### `Workercom.wrap(endpoint)` and `Workercom.expose(value, endpoint?)`

Workercom’s goal is to make _exposed_ values from one thread available in the other. `expose` exposes `value` on `endpoint`, where `endpoint` is a [`postMessage`-like interface][endpoint].

`wrap` wraps the _other_ end of the message channel and returns a proxy. The proxy will have all properties and functions of the exposed value, but access and invocations are inherently asynchronous. This means that a function that returns a number will now return _a promise_ for a number. **As a rule of thumb: If you are using the proxy, put `await` in front of it.** Exceptions will be caught and re-thrown on the other side.

### `Workercom.installTransfer(name, transferables)` & `Comlink.proxy`

By default, every function parameter, return value and object property value is copied, in the sense of [structured cloning]. Structured cloning can be thought of as deep copying, but has some limitations. See [this table][structured clone table] for details.

If you want a value to be transferred rather than copied — provided the value is or contains a [`Transferable`][transferable] — you can wrap the value in a `installTransfer()` call and provide a list of transferable values:

```ts
import { installTransfer } from "workercom";

installTransfer<ArrayBuffer, string>("arraybuffer", {
  canHandle: (value) => value instanceof ArrayBuffer,
  serialize: (value) => [_arrayBufferToBase64(value), []],
  deserialize: ({ raw }) => _base64ToArrayBuffer(raw),
});
```

Removed `Comlink.proxy()`. This will happen automatically

```ts
// myProxy.onready = Comlink.proxy((data) => {
//   /* ... */
// });

// * And now

myProxy.onready = (data) => {
   /* ... */
}
```

See more [default transfer](#Transfer-handlers-and-event-listeners)

### Transfer handlers and event listeners

It is common that you want to use Workercom to add an event listener, where the event source is on another thread:

```ts
button.addEventListener("click", myProxy.onClick.bind(myProxy));
```

While this won’t throw immediately, `onClick` will never actually be called. This is because [`Event`][event] is neither structured cloneable nor transferable. As a workaround, Workercom offers transfer handlers.

Each function parameter and return value is given to _all_ registered transfer handlers. If one of the event handler signals that it can process the value by returning `true` from `canHandle()`, it is now responsible for serializing the value to structured cloneable data and for deserializing the value. A transfer handler has be set up on _both sides_ of the message channel. Here’s an example transfer handler for events:

```ts
installTransfer<Event, {
   target: {
      id: string;
      classList: string[]
   }
}>("EVENT", {
  canHandle: (obj) => obj instanceof Event,
  serialize: (ev) => {
    return [
      {
        target: {
          id: ev.target.id,
          classList: [...ev.target.classList],
        },
      },
      [],
    ];
  },
  deserialize: (obj) => obj,
});
```

Note that this particular transfer handler won’t create an actual `Event`, but just an object that has the `event.target.id` and `event.target.classList` property. Often, this is enough. If not, the transfer handler can be easily augmented to provide all necessary data.

***Default conversion support for [`function`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function?retiredLocale=vi), [`class`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes?retiredLocale=vi), [`Error`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error?retiredLocale=vi) family, [`TypedArray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray) family***

### `Workercom.releaseProxy`

Every proxy created by Workercom has the `[releaseProxy]` method.
Calling it will detach the proxy and the exposed object from the message channel, allowing both ends to be garbage collected.

```ts
const proxy = wrap(port);
// ... use the proxy ...
proxy[releaseProxy]();
```

### `Workercom.createEndpoint`

Every proxy created by Workercom has the `[createEndpoint]` method.
Calling it will return a new `MessagePort`, that has been hooked up to the same object as the proxy that `[createEndpoint]` has been called on.

```ts
const port = myProxy[createEndpoint]();
const newProxy = wrap(port);
```

### `Workercom.windowEndpoint(window, context = self, targetOrigin = "*")`

Windows and Web Workers have a slightly different variants of `postMessage`. If you want to use Workercom to communicate with an iframe or another window, you need to wrap it with `windowEndpoint()`.

`window` is the window that should be communicate with. `context` is the `EventTarget` on which messages _from_ the `window` can be received (often `self`). `targetOrigin` is passed through to `postMessage` and allows to filter messages by origin. For details, see the documentation for [`Window.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

For a usage example, take a look at the non-worker examples in the `docs` folder.

## TypeScript

Workercom does provide TypeScript types. When you `expose()` something of type `T`, the corresponding `wrap()` call will return something of type `Workercom.Remote<T>`. While this type has been battle-tested over some time now, it is implemented on a best-effort basis. There are some nuances that are incredibly hard if not impossible to encode correctly in TypeScript’s type system. It _may_ sometimes be necessary to force a certain type using `as unknown as <type>`.

## Node

Workercom works with Node’s [`worker_threads`][worker_threads] module.

[webworker]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
[transferable]: https://developer.mozilla.org/en-US/docs/Web/API/Transferable
[messageport]: https://developer.mozilla.org/en-US/docs/Web/API/MessagePort
[delivrjs]: https://cdn.jsdelivr.net/
[es6 proxy]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
[proxy-polyfill]: https://github.com/GoogleChrome/proxy-polyfill
[endpoint]: src/index.ts
[structured cloning]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
[structured clone table]: structured-clone-table.md
[event]: https://developer.mozilla.org/en-US/docs/Web/API/Event
[worker_threads]: https://nodejs.org/api/worker_threads.html
[typedarray]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray

---

License [MIT](./LICENSE)
# Behavior of [Structured Clone]

[Structured clone] is JavaScript’s algorithm to create “deep copies” of values. It is used for `postMessage()` and therefore is used extensively under the hood with Workercom. By default, every function parameter and function return value is structured cloned. Here is a table of how the structured clone algorithm handles different kinds of values. Or to phrase it differently: If you pass a value from the left side as a parameter into a proxy’d function, the actual function code will get what is listed on the right side.

<span style="color: #F9A825"> Yellow </span>: Can full copy if [installTransfer](./README.md#API-Workercom\.installTransfer(name,-transferables)`-&-`Comlink\.proxy)
<span style="color: #76FF03"> Green </span>: Can full copy by transfer installed default
<span style="color: #FF3D00"> Warning </span>: Can't copy if you don't have transfer installed


| Input                      |     Output     | Notes                                                                                        |
| -------------------------- | :------------: | -------------------------------------------------------------------------------------------- |
| `[1,2,3]`                  |   `[1,2,3]`    | Full copy                                                                                    |
| `{a: 1, b: 2}`             | `{a: 1, b: 2}` | Full copy                                                                                    |
| `{a: 1, b() { return 2; }` |    `{a: 1, b: () => Promise<2>}`    | Full copy                                                              |
| `new MyClass()`            |    `{...}`     | Just the properties                                                                          |
| `Map`                      |     `Map`      | <span style="color: #F9A825">[`Map`][map] is structured cloneable or full copy   </span>               |
| `Set`                      |     `Set`      | <span style="color: #F9A825">[`Set`][set] is structured cloneable or full copy         </span>                                                                                  |
| `ArrayBuffer`              | `ArrayBuffer`  | <span style="color: #76FF03">[`ArrayBuffer`][arraybuffer] full copy     </span>                                                                       |
| `TypedArray`              | `TypedArray`  |  <span style="color: #76FF03">[`TypedArray`][typedarray] full copy     </span>        
| `Function`              | `Function => Promise`  |  <span style="color: #76FF03">[`Function`][function] full copy     </span>     
| `Error`              | `Error`  |  <span style="color: #76FF03">[`Error`][error] full copy     </span>                      
| `Event`                    |       ❌       |                                                                                              |
| Any DOM element            |       ❌       |                                                                                              |
| `MessagePort`              |      `MessagePort`       | <span style="color: #FF3D00">Only transferable, not structured cloneable         </span>                                         |
| `Request`                  |       ❌       |                                                                                              |
| `Response`                 |       ❌       |                                                                                              |
| `ReadableStream`           |       ❌       | [Streams are planned to be transferable][transferable streams], but not structured cloneable |

## Other transfers
### Transfer for MessagePort

``` ts
import { installTransfer } from "workercom"

installTransfer<MessagePort, MessagePort>({
   canHandle: (value) => value instanceof MessagePort,
   serialize: (port) => [port, [port]],
   deserialize: ({ raw: port }) => port,
})
```
### Transfer for Event

```ts
import { installTransfer } from "workercom"

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

[structured clone]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
[map]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
[set]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
[arraybuffer]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer
[uint32array]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint32Array
[transferable streams]: https://github.com/whatwg/streams/blob/master/transferable-streams-explainer.md
[typedarray]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray
[function]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function?retiredLocale=vi
[class]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes?retiredLocale=vi
[error]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error?retiredLocale=vi
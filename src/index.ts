import { atob, btoa } from "js-base64";

export const createEndpoint = Symbol("workercom.endpoint");
export const releaseProxy = Symbol("workercom.releaseProxy");
const transfused = "workercom.transfused";
const throwError = Symbol("workercom.throwError");

type ProxyMethods = {
  readonly [createEndpoint]: () => Promise<MessagePort>;
  readonly [releaseProxy]: () => void;
};
type Promisify<T> = T extends Promise<unknown> ? T : Promise<T>;

type Unpromisify<P> = P extends Promise<infer T> ? T : P;

export type Remote<T> =
  // Handle properties
  RemoteObject<T> &
    // Handle call signature (if present)
    (T extends (...args: infer TArguments) => infer TReturn
      ? (
          ...args: {
            readonly [I in keyof TArguments]: TArguments[I];
          }
        ) => Promisify<Unpromisify<TReturn>>
      : unknown) &
    (T extends { new (...args: infer TArguments): infer TInstance }
      ? {
          new (
            ...args: {
              readonly [I in keyof TArguments]: TArguments[I];
            }
          ): Promisify<Remote<TInstance>>;
        }
      : unknown) &
    ProxyMethods;

type RemoteObject<T> = { readonly [P in keyof T]: RemoteProperty<T[P]> };

type RemoteProperty<T> =
  // eslint-disable-next-line @typescript-eslint/ban-types
  T extends Function ? Remote<T> : Promisify<T>;

// eslint-disable-next-line @typescript-eslint/ban-types
type LocalProperty<T> = T extends Function ? Local<T> : Unpromisify<T>;

type LocalObject<T> = { readonly [P in keyof T]: LocalProperty<T[P]> };

type MaybePromise<T> = Promise<T> | T;

type Local<T> = Omit<LocalObject<T>, keyof ProxyMethods> &
  // Handle call signatures (if present)
  (T extends (...args: infer TArguments) => infer TReturn
    ? (
        ...args: {
          readonly [I in keyof TArguments]: TArguments[I];
        }
      ) => MaybePromise<Unpromisify<TReturn>>
    : unknown) &
  (T extends { new (...args: infer TArguments): infer TInstance }
    ? {
        new (
          ...args: {
            readonly [I in keyof TArguments]: TArguments[I];
          }
        ): MaybePromise<Local<Unpromisify<TInstance>>>;
      }
    : unknown);

enum MessageType {
  GET = "get",
  SET = "set",
  APPLY = "apply",
  CONSTRUCT = "construct",
  ENDPOINT = "endpoint",
  RELEASE = "release",
}

type EventSource = {
  readonly addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    // eslint-disable-next-line @typescript-eslint/ban-types
    options?: {}
  ) => void;

  readonly removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    // eslint-disable-next-line @typescript-eslint/ban-types
    options?: {}
  ) => void;
};

type Endpoint = EventSource & {
  // eslint-disable-next-line functional/no-method-signature
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;

  readonly start?: () => void;
};

type Transfer<Source = unknown, To = Source> = {
  // eslint-disable-next-line functional/no-method-signature, @typescript-eslint/no-explicit-any
  canHandle(value: any): boolean;
  // eslint-disable-next-line functional/no-method-signature
  serialize(
    value: Source,
    parent: unknown
  ): readonly [To, (readonly Transferable[])?];
  // eslint-disable-next-line functional/no-method-signature
  deserialize(value: { readonly raw: To }): Source;
};

function generateUUID(): string {
  return new Array(4)
    .fill(0)
    .map(() => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(16))
    .join("-");
}

// eslint-disable-next-line @typescript-eslint/ban-types
type Message = {} & (
  | {
      readonly type: MessageType.GET;
      readonly path: readonly string[];
    }
  | {
      readonly type: MessageType.SET;
      readonly path: readonly string[];
      readonly value: unknown;
    }
  | {
      readonly type: MessageType.ENDPOINT;
    }
  | {
      readonly type: MessageType.RELEASE;
    }
  | {
      readonly type: MessageType.APPLY;
      readonly path: readonly string[];
      // eslint-disable-next-line functional/functional-parameters
      readonly arguments: readonly unknown[];
    }
  | {
      readonly type: MessageType.CONSTRUCT;
      readonly path: readonly string[];
      // eslint-disable-next-line functional/functional-parameters
      readonly arguments: readonly unknown[];
    }
);

function requestResponseMessage(
  endpoint: Endpoint,
  msg: Message,
  transfers: readonly Transferable[] = []
): Promise<unknown> {
  return new Promise((resolve) => {
    const id = generateUUID();

    // * handler response from worker by id

    endpoint.addEventListener("message", function handler(
      evt: MessageEvent
    ): void {
      if (evt.data.id === id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endpoint.removeEventListener("message", handler as any);
        resolve(evt.data.return);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (endpoint.start) {
      endpoint.start();
    }
    // * send request to worker
    endpoint.postMessage(
      {
        id,
        ...msg,
      },
      transfers
    );
  });
}

export function wrap<T>(endpoint: Endpoint): Remote<T> {
  return toProxy(endpoint);
}

function isMessagePort(port: Endpoint): port is MessagePort {
  return port.constructor.name === "MessagePort";
}

function toProxy(
  endpoint: Endpoint,
  path: readonly (string | symbol)[] = [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patch?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const proxy = new Proxy(() => {}, {
    get(_target, p) {
      const valInPatch =
        patch && path.slice(0, -1).reduce((obj, prop) => obj[prop], patch);

      if (patch && p in valInPatch) {
        return valInPatch;
      }

      if (p === "then") {
        if (path.length === 0) {
          return Promise.resolve(proxy);
        }

        return requestResponseMessage(endpoint, {
          type: MessageType.GET,
          path: path.map((item) => item.toString()),
        }).then((ret) => argvMapToArguments([ret])[0]);
      }

      return toProxy(endpoint, [...path, p]);
    },
    set(_target, p, value) {
      const argvMapValue = argumentsToArgvMap([value]);

      if (patch) {
        // eslint-disable-next-line functional/immutable-data
        patch[p] = value;

        return true;
      }

      void requestResponseMessage(
        endpoint,
        {
          type: MessageType.SET,
          path: [...path, p].map((item) => item.toString()),
          value: argvMapValue.value,
        },
        argvMapValue.transfers
      );

      return true; // tấu hài đi vào lòng đất
    },
    apply(_target, _thisArg, argArray) {
      const name = path[path.length - 1] || "";

      if (name === createEndpoint) {
        return requestResponseMessage(endpoint, {
          type: MessageType.ENDPOINT,
        }).then((ret) => argvMapToArguments([ret])[0]);
      }
      if (name === releaseProxy) {
        return requestResponseMessage(endpoint, {
          type: MessageType.RELEASE,
        }).then(() => {
          if (isMessagePort(endpoint)) {
            endpoint.close();
          }
        });
      }

      if (name === "bind") {
        return toProxy(endpoint, path.slice(0, -1));
      }
      if (name === "call") {
        argArray = argArray.slice(1);
      }
      if (name === "apply") {
        argArray = argArray[1];
      }

      const mapArgArray = argumentsToArgvMap(argArray);

      return requestResponseMessage(
        endpoint,
        {
          type: MessageType.APPLY,
          arguments: mapArgArray.value,
          path: path.map((item) =>
            typeof item === "string" ? item : item.toString()
          ),
        },
        mapArgArray.transfers
      ).then((ret) => argvMapToArguments([ret])[0]);
    },
    construct(_target, argArray) {
      const mapArgArray = argumentsToArgvMap(argArray);

      return requestResponseMessage(
        endpoint,
        {
          type: MessageType.CONSTRUCT,
          arguments: mapArgArray.value,
          path: path.map((item) =>
            typeof item === "string" ? item : item.toString()
          ),
        },
        mapArgArray.transfers
      ).then((ret) => argvMapToArguments([ret])[0]);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  return proxy;
}

export function expose(
  obj: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  endpoint: Endpoint = self as any,
  sf?: unknown
): void {
  endpoint.addEventListener("message", function callback(
    ev: MessageEvent
  ): void {
    // eslint-disable-next-line functional/no-let
    let returnValue: unknown;
    // eslint-disable-next-line functional/no-let
    let transfers: readonly Transferable[] = [];
    try {
      const parent = ev.data.path
        .slice(0, -1)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .reduce((obj: any, prop: string) => obj[prop], obj);
      const rawValue = ev.data.path.reduce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (obj: any, prop: string) => obj[prop],
        obj
      );

      switch (ev.data.type) {
        case MessageType.GET:
          returnValue = rawValue;
          break;

        case MessageType.SET:
          // eslint-disable-next-line functional/immutable-data
          parent[ev.data.path[ev.data.path.length - 1]] = argvMapToArguments(
            ev.data.value
          )[0];
          returnValue = true;
          break;
        case MessageType.APPLY:
          returnValue = rawValue.call(
            sf ?? parent,
            ...argvMapToArguments(ev.data.arguments || [])
          );
          break;
        case MessageType.CONSTRUCT:
          returnValue = new rawValue(...argvMapToArguments(ev.data.arguments));
          break;

        case MessageType.ENDPOINT:
          // eslint-disable-next-line no-case-declarations
          const { port1, port2 } = new MessageChannel();
          expose(obj, port1);
          returnValue = port2;
          transfers = [port2];
          break;
        case MessageType.RELEASE:
          break;
        default:
          return void 0;
      }
    } catch (err: any) {
      // eslint-disable-next-line functional/immutable-data
      err[throwError] = true;
      returnValue = Promise.reject(err);
    }

    void Promise.resolve(returnValue)
      .catch((err) => {
        return err;
      })
      .then((ret) => {
        const argvMapOfTheRet = argumentsToArgvMap([ret]);

        endpoint.postMessage(
          {
            id: ev.data.id,
            return: argvMapOfTheRet.value[0],
          },
          [...transfers, ...argvMapOfTheRet.transfers]
        );

        if (ev.data.type === MessageType.RELEASE) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          endpoint.removeEventListener("message", callback as any);

          if (isMessagePort(endpoint)) {
            endpoint.close();
          }
        }
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (endpoint.start) {
    endpoint.start();
  }
}

const transfersInstalled = new Map<string, Transfer<unknown, unknown>>();

export function installTransfer<Source, To>(
  type: string,
  transfer: Transfer<Source, To>
): void {
  transfersInstalled.set(type, transfer);
}

function keys(obj: unknown, fulltext = true): readonly string[] {
  if (Array.isArray(obj)) {
    return new Array(obj.length).fill(0).map((_v, i) => i + "");
  }

  if (fulltext) {
    const prototype = Object.getPrototypeOf(obj);

    const props: readonly string[] = [
      ...new Set(
        [
          ...Object.getOwnPropertyNames(obj),
          ...(Object.getPrototypeOf(prototype)
            ? Object.getOwnPropertyNames(prototype)
            : []),
        ].filter(
          (p, i, arr) =>
            p !== "constructor" &&
            p !== "__proto__" && //not the constructor
            (i == 0 || p !== arr[i - 1])
        )
      ),
    ];

    return props;
  }

  return Object.getOwnPropertyNames(obj).filter(
    (p, i, arr) =>
      p !== "constructor" && //not the constructor
      (i == 0 || p !== arr[i - 1])
  );
}

function argumentsToArgvMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  argvs: readonly any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parent: any = self,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  weakCache: WeakMap<any, any> | null = new WeakMap() // đây là trình quản lý cache để tránh lăp vô hạn object --- toàn bộ transfer đã tồn tại nếu dc cài đặt cache
): {
  readonly value: readonly unknown[];
  readonly transfers: readonly Transferable[];
} {
  // eslint-disable-next-line functional/prefer-readonly-type
  const argvMap: unknown[] = [];
  // eslint-disable-next-line functional/prefer-readonly-type
  const transfers: Transferable[] = [];

  const { length } = argvs;
  // eslint-disable-next-line functional/no-let
  let index = 0;

  // eslint-disable-next-line functional/no-loop-statement
  whileMain: while (index < length) {
    const argv = argvs[index];

    if (weakCache?.has(argv)) {
      // eslint-disable-next-line functional/immutable-data
      argvMap[index] = weakCache.get(argv);
      index++;
      continue;
    }

    // eslint-disable-next-line functional/no-loop-statement
    for (const [transferName, transfer] of transfersInstalled.entries()) {
      if (transfer.canHandle(argv)) {
        const sr = transfer.serialize(argv, parent);

        const hydrated = {
          transfer: transferName,
          raw: sr[0],
          [transfused]: true,
        };
        weakCache?.set(argv, hydrated);
        // eslint-disable-next-line functional/immutable-data
        transfers.push(...(sr[1] || []));

        // eslint-disable-next-line functional/immutable-data
        argvMap[index] = hydrated;

        break whileMain;
      }
    }

    if (argv && typeof argv === "object") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newArgvMapForArgv: any = Array.isArray(argv) ? [] : {};

      weakCache?.set(argv, newArgvMapForArgv);

      keys(argv).forEach((key) => {
        if (key === "__proto__") {
          return; // cuts
        }

        const mapArgv = argumentsToArgvMap([argv[key]], argv, weakCache);

        // eslint-disable-next-line functional/immutable-data
        newArgvMapForArgv[key] = mapArgv.value[0];
        // eslint-disable-next-line functional/immutable-data
        transfers.push(...mapArgv.transfers);
      });

      // eslint-disable-next-line functional/immutable-data
      argvMap[index] = newArgvMapForArgv;
      // }
      index++;
      continue;
    }

    // eslint-disable-next-line functional/immutable-data
    argvMap[index] = argv;

    index++;
  }

  weakCache = null;

  return {
    value: argvMap,
    transfers,
  };
}

function argvMapToArguments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  argvMaps: readonly any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  weakCache: WeakMap<any, any> | null = new WeakMap() // đây là trình quản lý cache để tránh lăp vô hạn object
): readonly unknown[] {
  // eslint-disable-next-line functional/prefer-readonly-type
  const argvs: unknown[] = [];

  const { length } = argvMaps;
  // eslint-disable-next-line functional/no-let
  let index = 0;

  // eslint-disable-next-line functional/no-loop-statement
  while (index < length) {
    const argvMap = argvMaps[index];

    if (weakCache?.has(argvMap)) {
      // eslint-disable-next-line functional/immutable-data
      argvs[index] = weakCache.get(argvMap);

      index++;
      continue;
    }

    if (argvMap?.[transfused]) {
      /// exists transfer ?
      if (transfersInstalled.has(argvMap.transfer)) {
        // deserialize
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion, functional/immutable-data
        argvs[index] = transfersInstalled
          .get(argvMap.transfer)!
          .deserialize(argvMap);
        index++;
        continue;
      }
    }

    if (argvMap && typeof argvMap === "object") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newArgvForArgvMap: any = Array.isArray(argvMap) ? [] : {};

      weakCache?.set(argvMap, newArgvForArgvMap);

      keys(argvMap, false).forEach((key) => {
        if (key === "__proto__") {
          return; // cuts
        }

        // eslint-disable-next-line functional/immutable-data
        newArgvForArgvMap[key] = argvMapToArguments(
          [argvMap[key]],
          weakCache
        )[0];
      });

      // eslint-disable-next-line functional/immutable-data
      argvs[index] = newArgvForArgvMap;

      index++;

      continue;
      // }
    }

    // eslint-disable-next-line functional/immutable-data
    argvs[index] = argvMap;

    index++;
  }

  weakCache = null;

  return argvs;
}

type PostMessageWithOrigin = {
  readonly postMessage: (
    message: unknown,
    targetOrigin: string,
    transfer?: readonly Transferable[]
  ) => void;
};

export function windowEndpoint(
  w: PostMessageWithOrigin,
  context: EventSource = self,
  targetOrigin = "*"
): Endpoint {
  return {
    postMessage: (msg: unknown, transferables: readonly Transferable[]) =>
      w.postMessage(msg, targetOrigin, transferables),
    addEventListener: context.addEventListener.bind(context),
    removeEventListener: context.removeEventListener.bind(context),
  };
}

/** * Install transfer default * **/
installTransfer<
  // eslint-disable-next-line @typescript-eslint/ban-types
  Function,
  {
    readonly port: MessagePort;
    readonly property: unknown;
    readonly toString: string;
  }
>("function", {
  canHandle: (value) => typeof value === "function",
  serialize: (fn, parent) => {
    const { port1, port2 } = new MessageChannel();

    expose(fn, port1, parent);

    const { value, transfers } = argumentsToArgvMap([
      Object.assign(Object.create(fn), {
        prototype: undefined,
      }),
    ]);

    return [
      {
        port: port2,
        property: value[0],
        toString: fn.toString(),
      },
      [port2, ...transfers],
    ];
  },
  deserialize: ({ raw: { port, property, toString } }) => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const noop = () => {};

    const proto: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, functional/prefer-readonly-type
      [key: string]: any;
    } = {
      toString() {
        return toString;
      },
    };
    Object.getOwnPropertyNames(noop).forEach((prop) => {
      // fix : TypeError: 'caller', 'callee', and 'arguments' properties may not be accessed on strict mode functions or the arguments objects for calls to them
      switch (prop) {
        case "caller":
        case "calle":
          // eslint-disable-next-line functional/immutable-data
          proto[prop] = self;
          break;
        case "arguments":
          // eslint-disable-next-line functional/immutable-data
          proto[prop] = [];
          break;
        case "bind":
        case "call":
        case "apply":
          break;
        default:
          if (typeof noop[prop as keyof typeof noop] === "function") {
            // eslint-disable-next-line functional/immutable-data, @typescript-eslint/no-explicit-any
            proto[prop] = (noop[prop as keyof typeof noop] as any).bind(noop);
          } else {
            // eslint-disable-next-line functional/immutable-data
            proto[prop] = noop[prop as keyof typeof noop];
          }
      }
    });

    return toProxy(
      port,
      [],
      // eslint-disable-next-line functional/immutable-data
      Object.assign(proto, argvMapToArguments([property])[0])
    );
  },
});
installTransfer<
  | Error
  | {
      readonly [throwError]: true;
      readonly [prop: string]: unknown;
    },
  {
    readonly isError: boolean;
    readonly value:
      | {
          readonly message: string;
          readonly name: string;
          readonly stack: string;
          readonly [prop: string]: unknown;
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      | any;
  }
>("error", {
  canHandle: (value) => value instanceof Error || value?.[throwError],
  serialize: (value) => {
    // eslint-disable-next-line functional/no-let, @typescript-eslint/no-explicit-any
    let serialized: any;
    if (value instanceof Error) {
      serialized = {
        isError: true,
        value: {
          message: value.message,
          name: value.name,
          stack: value.stack,
        },
      };

      const props = keys(value);

      props.forEach((prop) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (value as any)[prop] === "function") {
          return; /// skip
        }

        // eslint-disable-next-line functional/immutable-data, @typescript-eslint/no-explicit-any
        serialized.value[prop] = (value as any)[prop];
      });
    } else {
      serialized = { isError: false, value };
    }

    return [serialized, []];
  },
  deserialize: ({ raw: serialized }) => {
    if (serialized.isError) {
      // eslint-disable-next-line functional/no-throw-statement
      throw Object.assign(
        new Error(serialized.value.message),
        serialized.value
      );
    }
    // eslint-disable-next-line functional/no-throw-statement
    throw serialized.value;
  },
});

function _arrayBufferToBase64(buffer: ArrayBuffer): string {
  // eslint-disable-next-line functional/no-let
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  // eslint-disable-next-line functional/no-let
  let i = 0;
  // eslint-disable-next-line functional/no-loop-statement
  while (i < len) {
    binary += String.fromCharCode(bytes[i++]);
  }
  return btoa(binary);
}
function _base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  // eslint-disable-next-line functional/no-let
  let i = 0;
  // eslint-disable-next-line functional/no-loop-statement
  while (i < len) {
    // eslint-disable-next-line functional/immutable-data
    bytes[i] = binary_string.charCodeAt(i++);
  }
  return bytes.buffer;
}

const TypedArrayConstructors = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,

  Int16Array,
  Uint16Array,

  Int32Array,
  Uint32Array,
  Float32Array,

  ...(typeof BigInt64Array !== "undefined" ? [BigInt64Array] : []),
  ...(typeof BigUint64Array !== "undefined" ? [BigUint64Array] : []),
  Float64Array,
];

function getNameTypedArrayConstructorUsed(typed: unknown) {
  return TypedArrayConstructors.find(
    (typedArrayItem) => typed instanceof typedArrayItem
  )?.name;
}

installTransfer<ArrayBuffer, string>("arraybuffer", {
  canHandle: (value) => value instanceof ArrayBuffer,
  serialize: (value) => [_arrayBufferToBase64(value), []],
  deserialize: ({ raw }) => _base64ToArrayBuffer(raw),
});
installTransfer<
  typeof TypedArrayConstructors[0]["prototype"],
  {
    readonly typedArrayName: string;
    readonly base64: string;
  }
>("typedarray", {
  canHandle: (value) => !!getNameTypedArrayConstructorUsed(value),
  serialize: (value) => [
    {
      typedArrayName: getNameTypedArrayConstructorUsed(value) as string,
      base64: _arrayBufferToBase64(value.buffer),
    },
    [],
  ],
  deserialize: ({ raw }) => {
    const typedArrayItem = TypedArrayConstructors.find(
      (typedArrayItem) => typedArrayItem.name === raw.typedArrayName
    ) as typeof TypedArrayConstructors[0];

    return new typedArrayItem(_base64ToArrayBuffer(raw.base64));
  },
});

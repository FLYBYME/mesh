var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/eventemitter3/index.js
var require_eventemitter3 = __commonJS({
  "node_modules/eventemitter3/index.js"(exports, module) {
    "use strict";
    var has = Object.prototype.hasOwnProperty;
    var prefix = "~";
    function Events() {
    }
    if (Object.create) {
      Events.prototype = /* @__PURE__ */ Object.create(null);
      if (!new Events().__proto__) prefix = false;
    }
    function EE(fn, context, once) {
      this.fn = fn;
      this.context = context;
      this.once = once || false;
    }
    function addListener(emitter, event, fn, context, once) {
      if (typeof fn !== "function") {
        throw new TypeError("The listener must be a function");
      }
      var listener = new EE(fn, context || emitter, once), evt = prefix ? prefix + event : event;
      if (!emitter._events[evt]) emitter._events[evt] = listener, emitter._eventsCount++;
      else if (!emitter._events[evt].fn) emitter._events[evt].push(listener);
      else emitter._events[evt] = [emitter._events[evt], listener];
      return emitter;
    }
    function clearEvent(emitter, evt) {
      if (--emitter._eventsCount === 0) emitter._events = new Events();
      else delete emitter._events[evt];
    }
    function EventEmitter2() {
      this._events = new Events();
      this._eventsCount = 0;
    }
    EventEmitter2.prototype.eventNames = function eventNames() {
      var names = [], events, name;
      if (this._eventsCount === 0) return names;
      for (name in events = this._events) {
        if (has.call(events, name)) names.push(prefix ? name.slice(1) : name);
      }
      if (Object.getOwnPropertySymbols) {
        return names.concat(Object.getOwnPropertySymbols(events));
      }
      return names;
    };
    EventEmitter2.prototype.listeners = function listeners(event) {
      var evt = prefix ? prefix + event : event, handlers = this._events[evt];
      if (!handlers) return [];
      if (handlers.fn) return [handlers.fn];
      for (var i = 0, l = handlers.length, ee = new Array(l); i < l; i++) {
        ee[i] = handlers[i].fn;
      }
      return ee;
    };
    EventEmitter2.prototype.listenerCount = function listenerCount(event) {
      var evt = prefix ? prefix + event : event, listeners = this._events[evt];
      if (!listeners) return 0;
      if (listeners.fn) return 1;
      return listeners.length;
    };
    EventEmitter2.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt]) return false;
      var listeners = this._events[evt], len = arguments.length, args, i;
      if (listeners.fn) {
        if (listeners.once) this.removeListener(event, listeners.fn, void 0, true);
        switch (len) {
          case 1:
            return listeners.fn.call(listeners.context), true;
          case 2:
            return listeners.fn.call(listeners.context, a1), true;
          case 3:
            return listeners.fn.call(listeners.context, a1, a2), true;
          case 4:
            return listeners.fn.call(listeners.context, a1, a2, a3), true;
          case 5:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
          case 6:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
        }
        for (i = 1, args = new Array(len - 1); i < len; i++) {
          args[i - 1] = arguments[i];
        }
        listeners.fn.apply(listeners.context, args);
      } else {
        var length = listeners.length, j;
        for (i = 0; i < length; i++) {
          if (listeners[i].once) this.removeListener(event, listeners[i].fn, void 0, true);
          switch (len) {
            case 1:
              listeners[i].fn.call(listeners[i].context);
              break;
            case 2:
              listeners[i].fn.call(listeners[i].context, a1);
              break;
            case 3:
              listeners[i].fn.call(listeners[i].context, a1, a2);
              break;
            case 4:
              listeners[i].fn.call(listeners[i].context, a1, a2, a3);
              break;
            default:
              if (!args) for (j = 1, args = new Array(len - 1); j < len; j++) {
                args[j - 1] = arguments[j];
              }
              listeners[i].fn.apply(listeners[i].context, args);
          }
        }
      }
      return true;
    };
    EventEmitter2.prototype.on = function on(event, fn, context) {
      return addListener(this, event, fn, context, false);
    };
    EventEmitter2.prototype.once = function once(event, fn, context) {
      return addListener(this, event, fn, context, true);
    };
    EventEmitter2.prototype.removeListener = function removeListener(event, fn, context, once) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt]) return this;
      if (!fn) {
        clearEvent(this, evt);
        return this;
      }
      var listeners = this._events[evt];
      if (listeners.fn) {
        if (listeners.fn === fn && (!once || listeners.once) && (!context || listeners.context === context)) {
          clearEvent(this, evt);
        }
      } else {
        for (var i = 0, events = [], length = listeners.length; i < length; i++) {
          if (listeners[i].fn !== fn || once && !listeners[i].once || context && listeners[i].context !== context) {
            events.push(listeners[i]);
          }
        }
        if (events.length) this._events[evt] = events.length === 1 ? events[0] : events;
        else clearEvent(this, evt);
      }
      return this;
    };
    EventEmitter2.prototype.removeAllListeners = function removeAllListeners(event) {
      var evt;
      if (event) {
        evt = prefix ? prefix + event : event;
        if (this._events[evt]) clearEvent(this, evt);
      } else {
        this._events = new Events();
        this._eventsCount = 0;
      }
      return this;
    };
    EventEmitter2.prototype.off = EventEmitter2.prototype.removeListener;
    EventEmitter2.prototype.addListener = EventEmitter2.prototype.on;
    EventEmitter2.prefixed = prefix;
    EventEmitter2.EventEmitter = EventEmitter2;
    if ("undefined" !== typeof module) {
      module.exports = EventEmitter2;
    }
  }
});

// src/RegistryPlugin.ts
var RegistryPlugin_exports = {};
__export(RegistryPlugin_exports, {
  RegistryPlugin: () => RegistryPlugin
});
var RegistryPlugin;
var init_RegistryPlugin = __esm({
  "src/RegistryPlugin.ts"() {
    "use strict";
    RegistryPlugin = class {
      constructor(registry) {
        this.registry = registry;
      }
      registry;
      name = "registry-plugin";
      onRegister(broker) {
        broker.setRegistry(this.registry);
        broker.use(async (ctx, next) => {
          if (!ctx.targetNodeID) {
            const endpoint = this.registry.selectNode(ctx.actionName, {
              action: ctx.actionName,
              params: ctx.params
            });
            if (endpoint) {
              ctx.targetNodeID = endpoint.nodeID;
            }
          }
          return await next();
        });
        broker.app.registerProvider("registry", this.registry);
      }
      async onStart() {
        await this.registry.start();
      }
      async onStop() {
        await this.registry.stop();
      }
    };
  }
});

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input2) {
    return getParsedType(input2.data);
  }
  _getOrReturnCtx(input2, ctx) {
    return ctx || {
      common: input2.parent.common,
      data: input2.data,
      parsedType: getParsedType(input2.data),
      schemaErrorMap: this._def.errorMap,
      path: input2.path,
      parent: input2.parent
    };
  }
  _processInputParams(input2) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input2.parent.common,
        data: input2.data,
        parsedType: getParsedType(input2.data),
        schemaErrorMap: this._def.errorMap,
        path: input2.path,
        parent: input2.parent
      }
    };
  }
  _parseSync(input2) {
    const result = this._parse(input2);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input2) {
    const result = this._parse(input2);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input2) {
    if (this._def.coerce) {
      input2.data = String(input2.data);
    }
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input2);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input2.data.length < check.value) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input2.data.length > check.value) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input2.data.length > check.value;
        const tooSmall = input2.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input2, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input2.data);
        } catch {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input2.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input2.data = input2.data.trim();
      } else if (check.kind === "includes") {
        if (!input2.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input2.data = input2.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input2.data = input2.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input2.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input2.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input2.data, check.version)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input2.data, check.alg)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input2.data, check.version)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input2.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input2) {
    if (this._def.coerce) {
      input2.data = Number(input2.data);
    }
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input2);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input2.data < check.value : input2.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input2.data > check.value : input2.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input2.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input2.data)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input2.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input2) {
    if (this._def.coerce) {
      try {
        input2.data = BigInt(input2.data);
      } catch {
        return this._getInvalidInput(input2);
      }
    }
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input2);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input2.data < check.value : input2.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input2.data > check.value : input2.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input2.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input2.data };
  }
  _getInvalidInput(input2) {
    const ctx = this._getOrReturnCtx(input2);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input2) {
    if (this._def.coerce) {
      input2.data = Boolean(input2.data);
    }
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input2.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input2) {
    if (this._def.coerce) {
      input2.data = new Date(input2.data);
    }
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input2);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input2.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input2);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input2.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input2.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input2, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input2.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input2.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input2.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input2.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input2) {
    return OK(input2.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input2) {
    return OK(input2.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input2) {
    const ctx = this._getOrReturnCtx(input2);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input2.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input2) {
    const { ctx, status } = this._processInputParams(input2);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input2);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input2);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input2) {
    const { status, ctx } = this._processInputParams(input2);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input2) {
    const { status, ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input2) {
    const { status, ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input2) {
    const { status, ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input2) {
    const { status, ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input2) {
    if (input2.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input2.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input2) {
    if (typeof input2.data !== "string") {
      const ctx = this._getOrReturnCtx(input2);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input2.data)) {
      const ctx = this._getOrReturnCtx(input2);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input2.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input2) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input2);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input2.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input2.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input2) {
    const { status, ctx } = this._processInputParams(input2);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input2);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input2);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input2) {
    const parsedType = this._getType(input2);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input2);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input2.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input2) {
    const { ctx } = this._processInputParams(input2);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input2) {
    const { status, ctx } = this._processInputParams(input2);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input2) {
    const result = this._def.innerType._parse(input2);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/contracts/tool_contract.ts
var defaultPrint = (output2) => {
  return typeof output2 === "string" ? output2 : JSON.stringify(output2, null, 2);
};
function defineContract(contract) {
  globalContractRegistry.register(contract);
  return contract;
}
function toolKey(contract) {
  return `${contract.domain}_${contract.action}`;
}
var ContractRegistry = class {
  contracts = /* @__PURE__ */ new Map();
  register(contract) {
    const key = toolKey(contract);
    if (this.contracts.has(key)) {
      return;
    }
    this.contracts.set(key, contract);
  }
  get(key) {
    return this.contracts.get(key);
  }
  entries() {
    return this.contracts.entries();
  }
  values() {
    return this.contracts.values();
  }
  get size() {
    return this.contracts.size;
  }
};
var globalKey = "mesh.globalContractRegistry";
var globalObj = globalThis;
if (!globalObj[globalKey]) {
  globalObj[globalKey] = new ContractRegistry();
}
var globalContractRegistry = globalObj[globalKey];

// src/contracts/crud_contract.ts
var CrudParamsSchema = external_exports.object({
  limit: external_exports.number().optional().describe("Max count of rows."),
  offset: external_exports.number().optional().describe("Number of skipped rows."),
  fields: external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]).optional().describe("Fields to return."),
  sort: external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]).optional().describe("Sorted fields. Use '-' prefix for descending."),
  search: external_exports.string().optional().describe("Search text."),
  searchFields: external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]).optional().describe("Fields for search."),
  query: external_exports.record(external_exports.string(), external_exports.unknown()).optional().describe("Query object."),
  populate: external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]).optional().describe("Populated fields.")
});
function defineCrud(domain, baseSchema, options = {}) {
  const plural = options.pluralPath || `${domain}s`;
  const idField = options.idField || "id";
  if (idField in baseSchema.shape) {
    throw new Error(`defineCrud Error: The ID field "${String(idField)}" must NOT be defined in the Zod baseSchema shape for domain "${domain}". Document IDs are handled automatically by the database layer.`);
  }
  const outputSchema = options.outputSchema || baseSchema.extend({
    [idField]: external_exports.string(),
    createdAt: external_exports.coerce.date(),
    updatedAt: external_exports.coerce.date()
  });
  const relations = options.relations || [];
  const actionNames = {
    find: "find",
    findOne: "find_one",
    count: "count",
    get: "get",
    resolve: "resolve",
    create: "create",
    createMany: "create_many",
    update: "update",
    replace: "replace",
    delete: "delete",
    ...options.actions
  };
  const eventNames = {
    create: "created",
    createMany: "created_many",
    update: "updated",
    replace: "replaced",
    delete: "deleted",
    ...options.events
  };
  const destructive = {
    find: false,
    findOne: false,
    count: false,
    get: false,
    resolve: false,
    create: true,
    createMany: true,
    update: true,
    replace: true,
    delete: true,
    ...options.destructive
  };
  const rawBase = baseSchema;
  const CreateInputSchema = rawBase.omit({ id: true, _id: true, createdAt: true, updatedAt: true });
  const UpdateInputSchema = rawBase.partial().extend({ [idField]: external_exports.string() });
  const ReplaceInputSchema = rawBase.extend({ [idField]: external_exports.string() });
  const IdInputSchema = external_exports.object({
    [idField]: external_exports.string()
  });
  const GetInputSchema = external_exports.object({ [idField]: external_exports.string() }).extend(CrudParamsSchema.shape);
  const ResolveInputSchema = external_exports.object({
    [idField]: external_exports.union([external_exports.string(), external_exports.array(external_exports.string())]),
    ...CrudParamsSchema.shape,
    mapping: external_exports.boolean().optional(),
    throwIfNotExist: external_exports.boolean().optional(),
    reorderResult: external_exports.boolean().optional()
  });
  const FindInputSchema = CrudParamsSchema;
  const FindOneInputSchema = CrudParamsSchema;
  const ResolveOutputSchema = external_exports.union([external_exports.array(outputSchema), external_exports.record(external_exports.string(), outputSchema)]);
  const findContract = defineContract({
    domain,
    action: actionNames.find,
    description: `Find ${plural} by query.`,
    inputSchema: FindInputSchema,
    outputSchema: external_exports.array(outputSchema),
    rest: { method: "GET", path: `/${plural}` },
    destructive: destructive.find,
    event: eventNames.find,
    isCrud: true,
    print: defaultPrint
  });
  const findOneContract = defineContract({
    domain,
    action: actionNames.findOne,
    description: `Find a single ${domain} by query.`,
    inputSchema: FindOneInputSchema,
    outputSchema: outputSchema.optional(),
    rest: { method: "GET", path: `/${plural}/one` },
    destructive: destructive.findOne,
    event: eventNames.findOne,
    isCrud: true,
    print: defaultPrint
  });
  const countContract = defineContract({
    domain,
    action: actionNames.count,
    description: `Get the number of ${plural} by query.`,
    inputSchema: external_exports.object({ search: CrudParamsSchema.shape.search, searchFields: CrudParamsSchema.shape.searchFields, query: CrudParamsSchema.shape.query }),
    outputSchema: external_exports.number(),
    rest: { method: "GET", path: `/${plural}/count` },
    destructive: destructive.count,
    event: eventNames.count,
    isCrud: true,
    print: defaultPrint
  });
  const getContract = defineContract({
    domain,
    action: actionNames.get,
    description: `Get a specific ${domain} by ID.`,
    inputSchema: GetInputSchema,
    outputSchema,
    rest: { method: "GET", path: `/${plural}/:${idField}` },
    destructive: destructive.get,
    event: eventNames.get,
    isCrud: true,
    print: defaultPrint
  });
  const resolveContract = defineContract({
    domain,
    action: actionNames.resolve,
    description: `Resolve one or more ${plural} by ID(s).`,
    inputSchema: ResolveInputSchema,
    outputSchema: ResolveOutputSchema,
    rest: { method: "POST", path: `/${plural}/resolve` },
    destructive: destructive.resolve,
    event: eventNames.resolve,
    isCrud: true,
    print: defaultPrint
  });
  const createContract = defineContract({
    domain,
    action: actionNames.create,
    description: `Create a new ${domain}.`,
    inputSchema: CreateInputSchema,
    outputSchema,
    rest: { method: "POST", path: `/${plural}` },
    destructive: destructive.create,
    event: eventNames.create || true,
    isCrud: true,
    print: defaultPrint
  });
  const createManyContract = defineContract({
    domain,
    action: actionNames.createMany,
    description: `Create multiple ${plural}.`,
    inputSchema: external_exports.array(CreateInputSchema),
    outputSchema: external_exports.array(outputSchema),
    rest: { method: "POST", path: `/${plural}/create-many` },
    destructive: destructive.createMany,
    event: eventNames.createMany || true,
    isCrud: true,
    print: defaultPrint
  });
  const updateContract = defineContract({
    domain,
    action: actionNames.update,
    description: `Update an existing ${domain}. Only specified fields will be updated.`,
    inputSchema: UpdateInputSchema,
    outputSchema,
    rest: { method: "PATCH", path: `/${plural}/:${idField}` },
    destructive: destructive.update,
    event: eventNames.update || true,
    isCrud: true,
    print: defaultPrint
  });
  const replaceContract = defineContract({
    domain,
    action: actionNames.replace,
    description: `Replace an existing ${domain}. Entire entity will be replaced.`,
    inputSchema: ReplaceInputSchema,
    outputSchema,
    rest: { method: "PUT", path: `/${plural}/:${idField}` },
    destructive: destructive.replace,
    event: eventNames.replace || true,
    isCrud: true,
    print: defaultPrint
  });
  const deleteContract = defineContract({
    domain,
    action: actionNames.delete,
    description: `Delete a specific ${domain} by ID.`,
    inputSchema: IdInputSchema,
    outputSchema: external_exports.object({ success: external_exports.boolean() }),
    rest: { method: "DELETE", path: `/${plural}/:${idField}` },
    destructive: destructive.delete,
    event: eventNames.delete || true,
    isCrud: true,
    print: defaultPrint
  });
  const crudResult = {
    domain,
    idField,
    baseSchema,
    outputSchema,
    relations,
    find: findContract,
    findOne: findOneContract,
    count: countContract,
    get: getContract,
    resolve: resolveContract,
    create: createContract,
    createMany: createManyContract,
    update: updateContract,
    replace: replaceContract,
    delete: deleteContract
  };
  return crudResult;
}

// demo-service/demo.contract.ts
var DemoHelloSchema = external_exports.object({
  name: external_exports.string().describe("Your name")
});
var DemoHelloOutputSchema = external_exports.object({
  message: external_exports.string().describe("Greeting message")
});
var demoHelloContract = defineContract({
  domain: "demo",
  action: "hello",
  description: "A simple hello world tool for demonstration.",
  inputSchema: DemoHelloSchema,
  outputSchema: DemoHelloOutputSchema,
  rest: { method: "POST", path: "/demo/hello" },
  destructive: false,
  print: defaultPrint
});
var BaseUserSchema = external_exports.object({
  name: external_exports.string(),
  email: external_exports.string().email(),
  status: external_exports.enum(["active", "inactive"]).default("active")
});
var DbUserSchema = BaseUserSchema.extend({
  id: external_exports.string()
});
var userCrud = defineCrud("demo", BaseUserSchema, {
  pluralPath: "users",
  actions: { create: "create_user", findOne: "find_user" }
});

// src/generated/client/MeshClient.ts
var MeshClient = class {
  constructor(app) {
    this.app = app;
  }
  app;
  contracts = {
    demo: {
      hello: demoHelloContract,
      create_user: userCrud["create"],
      find: userCrud["find"],
      find_one: userCrud["findOne"],
      count: userCrud["count"],
      get: userCrud["get"],
      update: userCrud["update"],
      delete: userCrud["delete"]
    }
  };
  api = {
    demo: {
      hello: async (args, opts) => {
        const result = await this.app.call("demo:hello", args, opts);
        return demoHelloContract.outputSchema.parse(result);
      },
      create_user: async (args, opts) => {
        const result = await this.app.call("demo:create_user", args, opts);
        return userCrud["create"].outputSchema.parse(result);
      },
      find: async (args, opts) => {
        const result = await this.app.call("demo:find", args, opts);
        return userCrud["find"].outputSchema.parse(result);
      },
      find_one: async (args, opts) => {
        const result = await this.app.call("demo:find_one", args, opts);
        return userCrud["findOne"].outputSchema.parse(result);
      },
      count: async (args, opts) => {
        const result = await this.app.call("demo:count", args, opts);
        return userCrud["count"].outputSchema.parse(result);
      },
      get: async (args, opts) => {
        const result = await this.app.call("demo:get", args, opts);
        return userCrud["get"].outputSchema.parse(result);
      },
      update: async (args, opts) => {
        const result = await this.app.call("demo:update", args, opts);
        return userCrud["update"].outputSchema.parse(result);
      },
      delete: async (args, opts) => {
        const result = await this.app.call("demo:delete", args, opts);
        return userCrud["delete"].outputSchema.parse(result);
      }
    }
  };
};

// src/utils/SafeTimer.ts
var SafeTimer = class {
  /**
   * Safely unrefs a timer if running in Node.js, doing nothing in the browser.
   * This prevents background timers from blocking the Node.js event loop exit.
   */
  static unref(timer) {
    if (timer && typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
  }
  /**
   * Safely clears an interval whether it's a Node Timeout or a Browser number.
   */
  static clearInterval(timer) {
    if (timer) {
      clearInterval(timer);
    }
  }
  /**
   * Safely clears a timeout whether it's a Node Timeout or a Browser number.
   */
  static clearTimeout(timer) {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

// src/core/MeshError.ts
var MeshErrorPayloadSchema = external_exports.object({
  code: external_exports.string(),
  message: external_exports.string(),
  status: external_exports.number().default(500),
  data: external_exports.unknown().optional(),
  stack: external_exports.string().optional(),
  correlationId: external_exports.string().optional()
});
var MeshError = class extends Error {
  code;
  status;
  data;
  correlationId;
  constructor(payload) {
    const data = typeof payload === "string" ? { message: payload, code: "INTERNAL_ERROR", status: 500 } : MeshErrorPayloadSchema.parse(payload);
    super(data.message);
    this.name = "MeshError";
    this.code = data.code;
    this.status = data.status;
    this.data = data.data;
    this.correlationId = data.correlationId;
    if (data.stack) this.stack = data.stack;
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      data: this.data,
      stack: this.stack,
      correlationId: this.correlationId
    };
  }
};

// src/core/BootOrchestrator.ts
var BootOrchestrator = class {
  constructor(app) {
    this.app = app;
  }
  app;
  async executeBootSequence(modules) {
    this.checkCircularDependencies(modules);
    this.printBootGraph(modules);
    const logger = this.app.getProvider("logger");
    let broker;
    if (this.app.hasProvider("broker")) {
      broker = this.app.getProvider("broker");
    }
    try {
      for (const mod of modules) {
        this.app.logger.info(`[Orchestrator] Initializing module: ${mod.name}`);
        mod.logger = logger.child ? logger.child({ module: mod.name }) : logger;
        if (!broker && this.app.hasProvider("broker")) {
          broker = this.app.getProvider("broker");
        }
        if (broker) {
          mod.serviceBroker = broker;
        }
        if (mod.onInit) {
          await mod.onInit(this.app);
        }
        if (!broker && this.app.hasProvider("broker")) {
          broker = this.app.getProvider("broker");
        }
      }
      for (const mod of modules) {
        this.app.logger.info(`[Orchestrator] Starting module: ${mod.name}`);
        if (mod.onStart) {
          await mod.onStart(this.app);
        }
      }
      for (const mod of modules) {
        if (mod.onReady) {
          await mod.onReady(this.app);
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.app.logger.error(`[BootOrchestrator] Boot sequence aborted due to error:`, { error: err.message });
      throw err;
    }
  }
  checkCircularDependencies(modules) {
    const visited = /* @__PURE__ */ new Set();
    const stack = /* @__PURE__ */ new Set();
    const moduleMap = /* @__PURE__ */ new Map();
    for (const mod of modules) {
      moduleMap.set(mod.name, mod);
    }
    const visit = (name) => {
      if (stack.has(name)) {
        throw new MeshError({
          message: `Circular dependency detected: ${Array.from(stack).join(" -> ")} -> ${name}`,
          code: "CIRCULAR_DEPENDENCY",
          status: 500
        });
      }
      if (visited.has(name)) return;
      visited.add(name);
      stack.add(name);
      const mod = moduleMap.get(name);
      if (mod && mod.dependencies) {
        for (const dep of mod.dependencies) {
          visit(dep);
        }
      }
      stack.delete(name);
    };
    for (const mod of modules) {
      visit(mod.name);
    }
  }
  printBootGraph(modules) {
    this.app.logger.info("\n--- \u{1F680} MeshApp Boot Graph ---");
    modules.forEach((mod, i) => {
      const prefix = i === modules.length - 1 ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
      this.app.logger.info(`${prefix} [${mod.name}]`);
    });
    this.app.logger.info("-----------------------------\n");
  }
  async executeTeardown(modules) {
    for (const mod of [...modules].reverse()) {
      if (mod.onStop) {
        await mod.onStop(this.app);
      }
    }
  }
};

// src/utils/ConsoleLogger.ts
var ConsoleLogger = class _ConsoleLogger {
  constructor(context = {}, level = 3 /* ERROR */) {
    this.context = context;
    this.level = level;
  }
  context;
  level;
  shouldLog(level) {
    return level >= this.level;
  }
  format(msg) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const ctx = Object.keys(this.context).length ? ` [${JSON.stringify(this.context)}]` : "";
    return `[${timestamp}]${ctx} ${msg}`;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug(msg, ...args) {
    if (globalThis.MESH_SILENT) return;
    if (this.shouldLog(0 /* DEBUG */)) console.debug(this.format(msg), ...args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info(msg, ...args) {
    if (globalThis.MESH_SILENT) return;
    if (this.shouldLog(1 /* INFO */)) console.info(this.format(msg), ...args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn(msg, ...args) {
    if (globalThis.MESH_SILENT) return;
    if (this.shouldLog(2 /* WARN */)) console.warn(this.format(msg), ...args);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error(msg, ...args) {
    if (globalThis.MESH_SILENT) return;
    if (this.shouldLog(3 /* ERROR */)) console.error(this.format(msg), ...args);
  }
  getLevel() {
    return this.level;
  }
  child(context) {
    return new _ConsoleLogger({ ...this.context, ...context }, this.level);
  }
};

// src/core/MeshApp.ts
var MeshApp = class {
  nodeID;
  namespace;
  config;
  logger;
  modules = [];
  pendingMiddleware = [];
  providers = /* @__PURE__ */ new Map();
  pendingServices = [];
  orchestrator;
  constructor(config) {
    this.nodeID = config.nodeID;
    this.namespace = config.namespace || "default";
    this.config = config;
    this.orchestrator = new BootOrchestrator(this);
    this.logger = config.logger || new ConsoleLogger({}, 1 /* INFO */);
    this.logger = this.logger.child({ nodeID: this.nodeID, namespace: this.namespace });
    this.registerProvider("logger", this.logger);
    this.registerProvider("app", this);
  }
  get registry() {
    return this.getProvider("registry");
  }
  getConfig() {
    return this.config;
  }
  use(moduleOrMiddleware) {
    if (typeof moduleOrMiddleware === "function") {
      if (this.hasProvider("broker")) {
        const broker = this.getProvider("broker");
        broker.use(moduleOrMiddleware);
      } else {
        this.pendingMiddleware.push(moduleOrMiddleware);
      }
    } else {
      this.modules.push(moduleOrMiddleware);
    }
    return this;
  }
  async registerService(service) {
    if (this.hasProvider("broker")) {
      const broker = this.getProvider("broker");
      await broker.registerService(service);
    } else {
      this.pendingServices.push(service);
    }
    return this;
  }
  getTokenKey(token) {
    if (typeof token === "string" || typeof token === "symbol") {
      return token.toString();
    }
    if (typeof token === "function" || typeof token === "object" && token !== null) {
      if ("id" in token && token.id) return String(token.id);
      if ("name" in token && typeof token.name === "string" && token.name !== "Function" && token.name !== "Object") return token.name;
    }
    throw new Error(`[MeshApp] Invalid provider token. Use a string, symbol, or a class/function with a stable name/id.`);
  }
  hasProvider(token) {
    try {
      const key = this.getTokenKey(token);
      return this.providers.has(key);
    } catch {
      return false;
    }
  }
  registerProvider(token, provider) {
    const key = this.getTokenKey(token);
    this.providers.set(key, provider);
    if (key === "broker") {
      const broker = provider;
      while (this.pendingMiddleware.length > 0) {
        broker.use(this.pendingMiddleware.shift());
      }
      while (this.pendingServices.length > 0) {
        const service = this.pendingServices.shift();
        if (service) {
          broker.registerService(service).catch((err) => {
            this.logger.error(`[MeshApp] Failed to register pending service: ${service.name}`, { error: err.message });
          });
        }
      }
    }
  }
  getProvider(token) {
    const key = this.getTokenKey(token);
    const provider = this.providers.get(key);
    if (provider === void 0) {
      throw new Error(`[MeshApp] Provider not found for token: ${key}`);
    }
    return provider;
  }
  async start() {
    this.logger.info("MeshApp starting...");
    await this.orchestrator.executeBootSequence(this.modules);
    this.logger.info("MeshApp started successfully.");
  }
  async call(action, params, opts) {
    const broker = this.getProvider("broker");
    return broker.call(action, params, opts);
  }
  async publish(topic, data) {
    if (this.hasProvider("broker")) {
      const broker = this.getProvider("broker");
      broker.emit(topic, data);
    } else {
      this.logger.warn(`[MeshApp] Cannot publish to ${topic}, broker not initialized.`);
    }
  }
  emit(event, payload) {
    const broker = this.getProvider("broker");
    broker.emit(event, payload);
  }
  async stop() {
    this.logger.info("MeshApp stopping...");
    await this.orchestrator.executeTeardown(this.modules);
    this.logger.info("MeshApp stopped.");
  }
};
function createMeshApp(config) {
  const app = new MeshApp(config);
  if (config.modules) {
    for (const mod of config.modules) {
      app.use(mod);
    }
  }
  return app;
}

// node_modules/nanoid/index.browser.js
var nanoid = (size = 21) => crypto.getRandomValues(new Uint8Array(size)).reduce((id, byte) => {
  byte &= 63;
  if (byte < 36) {
    id += byte.toString(36);
  } else if (byte < 62) {
    id += (byte - 26).toString(36).toUpperCase();
  } else if (byte > 62) {
    id += "-";
  } else {
    id += "_";
  }
  return id;
}, "");

// node_modules/eventemitter3/index.mjs
var import_index = __toESM(require_eventemitter3(), 1);

// src/core/ContextStack.ts
var ContextStack = class {
  static storage;
  static {
    try {
      const { AsyncLocalStorage } = __require("node:async_hooks");
      if (AsyncLocalStorage) {
        this.storage = new AsyncLocalStorage();
      }
    } catch {
    }
  }
  /**
   * Executes a function within a context.
   * Supports both synchronous and asynchronous functions.
   */
  static run(ctx, fn) {
    if (this.storage) {
      return this.storage.run(ctx, fn);
    }
    return fn();
  }
  /**
   * Retrieves the current context.
   */
  static getContext() {
    if (this.storage) {
      return this.storage.getStore();
    }
    return void 0;
  }
};

// src/core/ServiceBroker.ts
var MeshActionSchemaRegistry = /* @__PURE__ */ new Map();
var ServiceBroker = class {
  constructor(app) {
    this.app = app;
    this.logger = app.getProvider("logger") || app.logger;
  }
  app;
  localServices = /* @__PURE__ */ new Map();
  services = [];
  isStarted = false;
  // Bipartite Pipeline
  globalMiddleware = [];
  localMiddleware = [];
  plugins = [];
  localEvents = new import_index.default();
  pendingListeners = [];
  logger;
  registry;
  network;
  resiliency = {};
  // RPC Correlation
  pendingRequests = /* @__PURE__ */ new Map();
  pipe(plugin) {
    this.plugins.push(plugin);
    plugin.onRegister(this);
    return this;
  }
  setNetwork(network) {
    this.network = network;
    this.setupNetworkListeners();
  }
  setRegistry(registry) {
    this.registry = registry;
  }
  setupNetworkListeners() {
    if (!this.network) return;
    this.network.onMessage("*", (data, packet) => {
      if (packet.type === "RESPONSE" || packet.type === "RESPONSE_ERROR") {
        const correlationId = packet.meta?.correlationID || packet.id;
        const pending = this.pendingRequests.get(correlationId);
        if (pending) {
          SafeTimer.clearTimeout(pending.timeout);
          this.pendingRequests.delete(correlationId);
          try {
            if (packet.type === "RESPONSE_ERROR") {
              const errorData = packet.error;
              pending.reject(new Error(errorData?.message || "Remote RPC Error"));
            } else {
              pending.resolve(packet.data);
            }
          } catch (err) {
            this.logger.error(`[ServiceBroker] Bridge RPC error: ${err}`);
          }
        }
      } else if (packet.type === "EVENT") {
        this._triggerLocal(packet.topic, packet.data, packet);
      }
    });
  }
  use(mw) {
    this.globalMiddleware.push(mw);
  }
  useLocal(mw) {
    this.localMiddleware.push(mw);
  }
  getContext() {
    return ContextStack.getContext();
  }
  on(topic, handler) {
    if (topic.includes("*")) {
      const regex = new RegExp("^" + topic.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*") + "$");
      const wrapper = (payload, packet) => {
        const topicToTest = packet?.topic || topic;
        if (regex.test(topicToTest)) {
          handler(payload, packet);
        }
      };
      handler._wrapper = wrapper;
      this.localEvents.on("__pattern_event", wrapper);
    } else {
      this.localEvents.on(topic, handler);
    }
    return () => this.off(topic, handler);
  }
  off(topic, handler) {
    if (topic.includes("*")) {
      const wrapper = handler._wrapper;
      if (wrapper) this.localEvents.off("__pattern_event", wrapper);
    } else {
      this.localEvents.off(topic, handler);
    }
  }
  /**
   * Internal: Triggers local listeners from network events.
   */
  _triggerLocal(topic, data, packet) {
    this.localEvents.emit(topic, data, packet);
    this.localEvents.emit("__pattern_event", data, packet);
  }
  async registerService(service) {
    const serviceName = service.name || (service.constructor.name !== "Object" ? service.constructor.name.replace("Service", "").toLowerCase() : void 0);
    if (!serviceName) throw new Error("[ServiceBroker] Service name must be provided");
    this.logger.info(`[ServiceBroker] Registering service: ${serviceName} (Node: ${this.app.nodeID})`);
    this.services.push(service);
    if ("onInit" in service && typeof service.onInit === "function") {
      await service.onInit(this.app);
    }
    if (typeof service.created === "function") {
      await service.created(this.app);
    }
    const schemaActions = service.actions || {};
    this.logger.debug(`[ServiceBroker] Service '${serviceName}' has actions: ${Object.keys(schemaActions).join(", ")}`);
    for (const actionNameKey of Object.keys(schemaActions)) {
      const actionDef = schemaActions[actionNameKey];
      const handler = service[actionNameKey] || actionDef.handler;
      if (typeof handler === "function") {
        const actionName = `${serviceName}.${actionNameKey}`;
        MeshActionSchemaRegistry.set(actionName, {
          params: actionDef.params,
          returns: actionDef.returns,
          mutates: actionDef.mutates,
          timeout: actionDef.timeout
        });
        this.localServices.set(actionName, {
          handler: handler.bind(service),
          highSecurity: actionDef.highSecurity === true
        });
        this.logger.info(`[ServiceBroker] Action registered successfully: ${actionName}`);
      } else {
        this.logger.warn(`[ServiceBroker] Action '${serviceName}.${actionNameKey}' has no valid handler!`);
      }
    }
    if (this.registry) {
      this.registry.registerService(service);
    }
    if (this.isStarted && typeof service.started === "function") {
      await service.started();
    }
  }
  async call(action, params, options) {
    return this.internalCall(action, params, options);
  }
  emit(event, payload, options) {
    const packet = {
      id: nanoid(),
      topic: event,
      data: payload,
      senderNodeID: this.app.nodeID,
      type: "EVENT",
      timestamp: Date.now(),
      version: 1,
      priority: 1,
      meta: { local: true }
    };
    this._triggerLocal(event, payload, packet);
    if (this.network && !options?.skipNetwork) {
      this.network.publish(event, payload);
    }
  }
  async internalCall(actionName, params, options, parentCtx) {
    const schema = MeshActionSchemaRegistry.get(actionName);
    if (schema?.params && params !== void 0) {
      try {
        if (typeof schema.params.parse === "function") {
          params = schema.params.parse(params);
        }
      } catch (error) {
        throw new Error(`[ServiceBroker] Invalid params for action ${actionName}: ${error}`);
      }
    } else if (params === void 0) {
      params = {};
    }
    let targetNodeID = options?.nodeID;
    if (!targetNodeID && !this.localServices.has(actionName)) {
      if (this.registry) {
        const endpoint = this.registry.selectNode(actionName, {
          action: actionName,
          params
        });
        if (endpoint) {
          targetNodeID = endpoint.nodeID;
        }
      }
    }
    const activeCtx = parentCtx || this.getContext();
    const traceId = activeCtx?.traceId || nanoid();
    const parentId = activeCtx?.spanId;
    const spanId = nanoid();
    const timeout = options?.timeout || schema?.timeout;
    const ctx = {
      id: nanoid(),
      correlationID: activeCtx?.correlationID || nanoid(),
      actionName,
      params,
      meta: { ...activeCtx?.meta, timeout },
      targetNodeID,
      callerID: activeCtx?.id || null,
      nodeID: this.app.nodeID,
      traceId,
      spanId,
      parentId,
      call: (a, p, o) => this.call(a, p, { ...o, parentContext: ctx }),
      emit: (e, p) => this.emit(e, p)
    };
    const result = await this.handlePipeline(ctx);
    if (schema?.returns) {
      return schema.returns.parse(result);
    }
    return result;
  }
  async handleIncomingRPC(packet) {
    const meta = packet.meta || {};
    const targetNodeID = meta.finalDestinationID || packet.targetNodeID;
    const ctx = {
      id: packet.id,
      correlationID: packet.meta?.correlationID || packet.id,
      actionName: packet.topic,
      params: packet.data,
      meta,
      callerID: packet.senderNodeID,
      nodeID: this.app.nodeID,
      targetNodeID,
      traceId: meta.traceId || nanoid(),
      spanId: meta.spanId || nanoid(),
      parentId: meta.parentId,
      call: (a, p, o) => this.call(a, p, { ...o, parentContext: ctx }),
      emit: (e, p) => this.emit(e, p)
    };
    const result = await this.handlePipeline(ctx);
    const schema = MeshActionSchemaRegistry.get(packet.topic);
    if (schema?.returns) {
      return schema.returns.parse(result);
    }
    return result;
  }
  async handlePipeline(ctx) {
    return await ContextStack.run(ctx, async () => {
      try {
        const finalHandler = async () => {
          const isLocal = !ctx.targetNodeID || ctx.targetNodeID === this.app.nodeID;
          if (isLocal) {
            const action = this.localServices.get(ctx.actionName);
            if (!action) {
              this.logger.error(`[ServiceBroker] Local action not found: ${ctx.actionName}`, {
                targetNodeID: ctx.targetNodeID,
                appNodeID: this.app.nodeID,
                registeredActions: Array.from(this.localServices.keys())
              });
              throw new Error(`[ServiceBroker] Local action not found: ${ctx.actionName}`);
            }
            return await action.handler(ctx);
          } else {
            return await this.executeRemote(ctx.targetNodeID, ctx.actionName, ctx.params, ctx.meta);
          }
        };
        const isLocalInitially = !ctx.targetNodeID || ctx.targetNodeID === this.app.nodeID;
        const chain = [...this.globalMiddleware];
        if (isLocalInitially) {
          chain.push(...this.localMiddleware);
        }
        return await this.executeChain(ctx, chain, finalHandler);
      } catch (err) {
        ctx.error = err instanceof Error ? err : new Error(String(err));
        throw ctx.error;
      }
    });
  }
  async executeChain(ctx, chain, finalHandler) {
    const executeNext = async (index) => {
      if (index < chain.length) {
        return await chain[index](ctx, () => executeNext(index + 1));
      }
      return await finalHandler();
    };
    return await executeNext(0);
  }
  async executeRemote(nodeID, actionName, params, meta = {}) {
    if (!this.network) throw new Error("[ServiceBroker] Network not initialized");
    const requestId = meta.correlationID || meta.id || nanoid();
    const currentCtx = this.getContext();
    const tracingMeta = {
      traceId: currentCtx?.traceId,
      spanId: currentCtx?.spanId,
      parentId: currentCtx?.parentId
    };
    const schema = MeshActionSchemaRegistry.get(actionName);
    const timeoutMs = meta.timeout || schema?.timeout || this.app.config.rpcTimeout || 1e4;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`[ServiceBroker] RPC Timeout calling ${actionName} on ${nodeID} after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingRequests.set(requestId, { resolve, reject, timeout });
      this.network.send(nodeID, actionName, params, {
        id: requestId,
        type: "REQUEST",
        meta: { ...meta, ...tracingMeta, correlationID: requestId },
        senderNodeID: this.app.nodeID,
        topic: actionName
      }).catch((err) => {
        SafeTimer.clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
  async start() {
    this.isStarted = true;
    for (const plugin of this.plugins) {
      if (plugin.onStart) await plugin.onStart(this);
    }
    for (const service of this.services) {
      if (typeof service.started === "function") {
        await service.started();
      }
    }
  }
  async stop() {
    this.isStarted = false;
    for (const service of this.services) {
      if (typeof service.stopped === "function") {
        await service.stopped();
      }
    }
    for (const pending of this.pendingRequests.values()) {
      SafeTimer.clearTimeout(pending.timeout);
      pending.reject(new Error("Broker stopped"));
    }
    this.pendingRequests.clear();
    for (const plugin of this.plugins) {
      if (plugin.onStop) await plugin.onStop(this);
    }
  }
  createService() {
    throw new Error("Not implemented");
  }
  getSetting() {
    throw new Error("Not implemented");
  }
  setSetting() {
    throw new Error("Not implemented");
  }
};

// src/balancers/BaseBalancer.ts
var BaseBalancer = class {
};

// src/balancers/RoundRobinBalancer.ts
var RoundRobinBalancer = class extends BaseBalancer {
  counters = /* @__PURE__ */ new Map();
  MAX_COUNTERS = 1e3;
  select(nodes, ctx) {
    if (nodes.length === 0) return null;
    if (nodes.length === 1) return nodes[0];
    const key = ctx?.action || "default";
    if (this.counters.size > this.MAX_COUNTERS && !this.counters.has(key)) {
      this.counters.clear();
    }
    const counter = (this.counters.get(key) ?? 0) % nodes.length;
    this.counters.set(key, counter + 1);
    return nodes[counter];
  }
};

// src/core/KademliaRoutingTable.ts
var KademliaRoutingTable = class {
  buckets = [];
  localNodeID;
  localBigIntID;
  bucketSize;
  k = 20;
  constructor(localNodeID, bucketSize = 20) {
    this.localNodeID = localNodeID;
    this.localBigIntID = this.getBigIntID(localNodeID);
    this.bucketSize = bucketSize;
    for (let i = 0; i < 256; i++) {
      this.buckets[i] = [];
    }
  }
  getBigIntID(id, node) {
    const cachedNode = node;
    if (cachedNode && cachedNode.cachedBigIntID) return BigInt(cachedNode.cachedBigIntID);
    const bi = BigInt("0x" + this.toHex(id));
    if (cachedNode) cachedNode.cachedBigIntID = bi.toString();
    return bi;
  }
  addNode(info) {
    if (info.nodeID === this.localNodeID) return;
    const infoBigInt = this.getBigIntID(info.nodeID, info);
    const distance = this.localBigIntID ^ infoBigInt;
    const bucketIndex = this.getBucketIndex(distance);
    const bucket = this.buckets[bucketIndex];
    const existingIndex = bucket.findIndex((n) => n.nodeID === info.nodeID);
    if (existingIndex !== -1) {
      bucket[existingIndex] = info;
      const node = bucket.splice(existingIndex, 1)[0];
      bucket.push(node);
    } else if (bucket.length < this.bucketSize) {
      bucket.push(info);
    }
  }
  removeNode(nodeID) {
    const targetBigInt = this.getBigIntID(nodeID);
    const distance = this.localBigIntID ^ targetBigInt;
    const bucketIndex = this.getBucketIndex(distance);
    const bucket = this.buckets[bucketIndex];
    const index = bucket.findIndex((n) => n.nodeID === nodeID);
    if (index !== -1) {
      bucket.splice(index, 1);
    }
  }
  findClosestNodes(targetID, count) {
    const targetBigInt = this.getBigIntID(targetID);
    const bucketIndex = this.getBucketIndex(this.localBigIntID ^ targetBigInt);
    const results = [];
    const addFromBucket = (idx) => {
      for (const node of this.buckets[idx]) {
        results.push({
          node,
          distance: targetBigInt ^ this.getBigIntID(node.nodeID, node)
        });
      }
    };
    addFromBucket(bucketIndex);
    for (let i = 1; results.length < count && (bucketIndex - i >= 0 || bucketIndex + i < 256); i++) {
      if (bucketIndex - i >= 0) addFromBucket(bucketIndex - i);
      if (bucketIndex + i < 256) addFromBucket(bucketIndex + i);
    }
    return results.sort((a, b) => a.distance < b.distance ? -1 : a.distance > b.distance ? 1 : 0).slice(0, count).map((item) => item.node);
  }
  findNodesForService(serviceName, count) {
    const results = [];
    for (const bucket of this.buckets) {
      for (const node of bucket) {
        if (node.services.some((s) => s.name === serviceName || s.fullName === serviceName)) {
          results.push(node);
        }
        if (results.length >= count) return results;
      }
    }
    return results;
  }
  getBucketIndex(distance) {
    if (distance === BigInt(0)) return 0;
    return Math.min(255, distance.toString(2).length - 1);
  }
  toHex(str) {
    let res = "";
    for (let i = 0; i < str.length; i++) {
      res += str.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return res.padEnd(64, "0").slice(0, 64);
  }
};

// src/core/ServiceRegistry.ts
var getHostname = () => {
  try {
    const os = eval("require")("os");
    return os.hostname();
  } catch {
    return "browser-client";
  }
};
var ServiceRegistry = class extends import_index.default {
  constructor(logger, options = {}) {
    super();
    this.logger = logger;
    this.preferLocal = options.preferLocal ?? true;
    this.localNodeID = options.localNodeID || `node_${Math.random().toString(36).substr(2, 9)}`;
    this.dhtEnabled = options.dhtEnabled ?? false;
    this.ttl = options.ttl || 3e4;
    this.balancer = new RoundRobinBalancer();
    if (this.dhtEnabled) {
      this.dht = new KademliaRoutingTable(this.localNodeID);
    }
    this.registerNode({
      nodeID: this.localNodeID,
      type: "node",
      namespace: "default",
      addresses: [],
      available: true,
      timestamp: Date.now(),
      nodeSeq: 1,
      hostname: getHostname(),
      services: [],
      trustLevel: "internal",
      metadata: {},
      capabilities: {
        transports: ["ws"],
        features: ["relay"]
      },
      pid: typeof process !== "undefined" ? process.pid : 0,
      cpu: 0,
      activeRequests: 0,
      healthScore: 1
    });
  }
  logger;
  nodes = /* @__PURE__ */ new Map();
  dht = null;
  balancer;
  preferLocal;
  localNodeID;
  dhtEnabled;
  pruningTimer;
  metricsTimer;
  ttl;
  localServices = /* @__PURE__ */ new Map();
  /**
   * Resolves when the specified service is discovered in the mesh.
   */
  async waitForService(serviceName, timeoutMs = 15e3) {
    const isAvailable = () => this.getServiceNames().includes(serviceName);
    if (isAvailable()) return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off("changed", check);
        reject(new Error(`Timeout: Service "${serviceName}" not found after ${timeoutMs}ms`));
      }, timeoutMs);
      SafeTimer.unref(timer);
      const check = () => {
        if (isAvailable()) {
          SafeTimer.clearTimeout(timer);
          this.off("changed", check);
          resolve();
        }
      };
      this.on("changed", check);
    });
  }
  /**
   * Resolves when at least N nodes are discovered in the mesh.
   */
  async waitForNodes(count, timeoutMs = 15e3) {
    if (this.getAvailableNodes().length >= count) return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off("changed", check);
        reject(new Error(`Timeout: Only ${this.getAvailableNodes().length}/${count} nodes found`));
      }, timeoutMs);
      SafeTimer.unref(timer);
      const check = () => {
        if (this.getAvailableNodes().length >= count) {
          SafeTimer.clearTimeout(timer);
          this.off("changed", check);
          resolve();
        }
      };
      this.on("changed", check);
    });
  }
  async start() {
    if (this.pruningTimer) return;
    this.pruningTimer = setInterval(() => this.pruneStaleNodes(this.ttl), 5e3);
    SafeTimer.unref(this.pruningTimer);
    this.metricsTimer = setInterval(() => this.updateLocalMetrics(), 1e4);
    SafeTimer.unref(this.metricsTimer);
    this.logger.info(`ServiceRegistry started for node ${this.localNodeID}`);
  }
  async stop() {
    if (this.pruningTimer) {
      SafeTimer.clearInterval(this.pruningTimer);
      this.pruningTimer = void 0;
    }
    if (this.metricsTimer) {
      SafeTimer.clearInterval(this.metricsTimer);
      this.metricsTimer = void 0;
    }
  }
  updateLocalMetrics() {
    const localNode = this.nodes.get(this.localNodeID);
    if (!localNode) return;
    try {
      if (typeof process !== "undefined" && process.release?.name === "node") {
        const os2 = __require("os");
        const cpus = os2.cpus();
        if (cpus && cpus.length > 0) {
          const loadAvg = os2.loadavg();
          const cpuUsage = loadAvg[0] / cpus.length * 100;
          localNode.cpu = Math.round(Math.min(Math.max(cpuUsage, 0), 100));
        }
        const totalMem = os2.totalmem();
        if (totalMem > 0) {
          const ramUsage = process.memoryUsage().rss / totalMem * 100;
          localNode.activeRequests = Math.round(ramUsage * 100);
        }
      } else {
        localNode.cpu = Math.round(Math.random() * 20);
        localNode.activeRequests = Math.round(Math.random() * 40 * 100);
      }
      localNode.timestamp = Date.now();
      this.emit("local:changed");
    } catch {
    }
  }
  /**
   * Implementation of IServiceRegistry.listServices
   */
  listServices() {
    return Array.from(this.localServices.values());
  }
  /**
   * Implementation of IServiceRegistry.registerService
   */
  registerService(schema) {
    this.registerLocalService(schema);
  }
  unregisterService(serviceName) {
    this.localServices.delete(serviceName);
    const localNode = this.nodes.get(this.localNodeID);
    if (localNode) {
      localNode.services = localNode.services.filter((s) => s.name !== serviceName);
      localNode.nodeSeq++;
      this.registerNode(localNode);
    }
  }
  getService(serviceName) {
    return this.localServices.get(serviceName);
  }
  unregisterNode(nodeID) {
    if (this.nodes.delete(nodeID)) {
      if (this.dht) this.dht.removeNode(nodeID);
      this.emit("changed", nodeID);
    }
  }
  heartbeat(nodeID, data) {
    const node = this.nodes.get(nodeID);
    if (node) {
      node.timestamp = Date.now();
      if (data) {
        if (data.cpu !== void 0) node.cpu = data.cpu;
        if (data.activeRequests !== void 0) node.activeRequests = data.activeRequests;
      }
      const cpu = node.cpu || 0;
      const requests = node.activeRequests || 0;
      node.healthScore = Math.max(0, 1 - cpu / 100 - requests / 50);
      this.emit("heartbeat", nodeID);
    }
  }
  findNodesForAction(actionName) {
    const results = [];
    for (const node of this.nodes.values()) {
      if (!node.available) continue;
      for (const svc of node.services) {
        if (!svc.actions) continue;
        let action = svc.actions[actionName];
        if (!action && actionName.startsWith(svc.name + ".")) {
          const localName = actionName.substring(svc.name.length + 1);
          action = svc.actions[localName];
        }
        if (action) {
          results.push(node);
          break;
        }
      }
    }
    return results;
  }
  selectNode(actionName, _context) {
    const endpoint = this.getNextActionEndpoint(actionName);
    if (!endpoint) return void 0;
    const node = this.nodes.get(endpoint.nodeID);
    if (!node) return void 0;
    return {
      nodeID: node.nodeID,
      services: node.services.map((s) => s.name),
      metadata: node.metadata
    };
  }
  /**
   * Register or update a node's info.
   */
  registerNode(node) {
    const existing = this.nodes.get(node.nodeID);
    if (existing && (existing.nodeSeq ?? 0) > (node.nodeSeq ?? 0)) {
      return;
    }
    if (existing && (existing.nodeSeq ?? 0) === (node.nodeSeq ?? 0)) {
      existing.timestamp = Date.now();
      return;
    }
    const registryNode = {
      nodeID: node.nodeID,
      type: node.type,
      nodeType: node.nodeType,
      trustLevel: node.trustLevel || "public",
      namespace: node.namespace || "default",
      addresses: node.addresses,
      services: node.services,
      capabilities: node.capabilities || {},
      resources: node.resources,
      metadata: node.metadata || {},
      nodeSeq: node.nodeSeq || 1,
      hostname: node.hostname || "unknown",
      pid: node.pid || 0,
      timestamp: Date.now(),
      available: node.available ?? true,
      lastHeartbeatTime: node.lastHeartbeatTime,
      parentID: node.parentID,
      hidden: node.hidden,
      cpu: node.cpu,
      activeRequests: node.activeRequests,
      healthScore: node.healthScore
    };
    this.nodes.set(node.nodeID, registryNode);
    if (this.dht) this.dht.addNode(registryNode);
    this.emit("changed", node.nodeID);
    this.logger.debug(`Node ${node.nodeID} registered/updated`);
  }
  /**
   * Register a local service schema.
   */
  registerLocalService(schema) {
    this.localServices.set(schema.name, schema);
    const localNode = this.nodes.get(this.localNodeID);
    if (localNode) {
      const serviceInfo = {
        name: schema.name,
        version: schema.version || "1.0.0",
        actions: Object.keys(schema.actions || {}).reduce((acc, actionName) => {
          const action = schema.actions[actionName];
          acc[actionName] = {
            name: actionName,
            visibility: action.visibility || "public",
            params: action.params ? {} : void 0,
            metadata: action.metadata
          };
          return acc;
        }, {})
      };
      localNode.services = localNode.services || [];
      const idx = localNode.services.findIndex((s) => s.name === schema.name);
      if (idx >= 0) localNode.services[idx] = serviceInfo;
      else localNode.services.push(serviceInfo);
      localNode.nodeSeq = (localNode.nodeSeq || 0) + 1;
      this.registerNode(localNode);
      this.emit("local:changed");
    }
  }
  getNodes() {
    return Array.from(this.nodes.values());
  }
  getAvailableNodes() {
    return Array.from(this.nodes.values()).filter((n) => n.available);
  }
  getNode(nodeID) {
    const node = this.nodes.get(nodeID);
    return node ? node : void 0;
  }
  /**
   * Finds the best action target based on balancing logic.
   */
  getNextActionEndpoint(actionName) {
    const candidates = [];
    for (const node of this.nodes.values()) {
      if (!node.available) continue;
      for (const svc of node.services || []) {
        if (!svc.actions) continue;
        let action = svc.actions[actionName];
        if (!action && actionName.startsWith(svc.name + ".")) {
          const localName = actionName.substring(svc.name.length + 1);
          action = svc.actions[localName];
        }
        if (action) {
          candidates.push({ nodeID: node.nodeID, action });
        }
      }
    }
    if (candidates.length === 0) return void 0;
    if (this.preferLocal) {
      const local = candidates.find((c) => c.nodeID === this.localNodeID);
      if (local) return local;
    }
    const candidateNodes = candidates.map((c) => this.nodes.get(c.nodeID)).filter((n) => !!n);
    const selectedNode = this.balancer.select(candidateNodes, { action: actionName });
    if (!selectedNode) return void 0;
    for (const svc of selectedNode.services) {
      if (!svc.actions) continue;
      let action = svc.actions[actionName];
      if (!action && actionName.startsWith(svc.name + ".")) {
        const localName = actionName.substring(svc.name.length + 1);
        action = svc.actions[localName];
      }
      if (action) {
        return { nodeID: selectedNode.nodeID, action };
      }
    }
    return void 0;
  }
  /**
   * Removes nodes that haven't heartbeated within the TTL, and marks them offline if they miss recent heartbeats.
   */
  pruneStaleNodes(ttlMs) {
    const now = Date.now();
    let changed = false;
    for (const [nodeID, node] of this.nodes.entries()) {
      if (nodeID === this.localNodeID) continue;
      const age = now - (node.timestamp || 0);
      if (age > ttlMs) {
        this.nodes.delete(nodeID);
        if (this.dht) this.dht.removeNode(nodeID);
        this.logger.info(`Pruned stale node: ${nodeID}`);
        changed = true;
      } else if (age > 1e4 && node.available) {
        this.logger.info(`Node offline (missed heartbeats): ${nodeID}`);
        node.available = false;
        changed = true;
      }
    }
    if (changed) this.emit("changed");
  }
  getServiceNames() {
    const names = /* @__PURE__ */ new Set();
    for (const node of this.nodes.values()) {
      if (node.available) {
        for (const svc of node.services || []) {
          names.add(svc.name);
        }
      }
    }
    return Array.from(names);
  }
  setBalancer(balancer) {
    this.balancer = balancer;
  }
};

// src/core/TransportManager.ts
var TransportManager = class extends import_index.default {
  constructor(options, node) {
    super();
    this.node = node;
    if (options.transports.length === 0) {
      throw new Error("[TransportManager] At least one transport must be provided.");
    }
    for (const transport of options.transports) {
      transport.on("packet", (envelope) => this.emit("packet", envelope));
      transport.on("peer:connect", (peerNodeID) => {
        this.node.logger.debug(`Peer connected: ${peerNodeID}`, {
          peerNodeID,
          internal: true
        });
        this.node.orchestrator.handlePeerConnect(peerNodeID);
      });
      transport.on("peer:disconnect", (peerNodeID) => {
        this.node.logger.info(`Peer disconnected: ${peerNodeID}`, {
          peerNodeID,
          internal: true
        });
        this.node.orchestrator.handlePeerDisconnect(peerNodeID);
      });
      this.transports.set(transport.protocol, transport);
    }
    this.primaryTransport = options.transports[0];
  }
  node;
  transports = /* @__PURE__ */ new Map();
  primaryTransport;
  async connect(opts) {
    for (const t of this.transports.values()) {
      await t.connect({
        url: opts.url || "",
        nodeID: this.node.nodeID,
        namespace: this.node.namespace,
        logger: this.node.logger,
        port: opts.port,
        registry: opts.registry,
        sharedServer: opts.sharedServer,
        sharedApp: opts.sharedApp,
        host: opts.host,
        authToken: opts.authToken
      });
      await t.start();
    }
  }
  async disconnect() {
    for (const t of this.transports.values()) {
      await t.disconnect();
    }
  }
  getTransport() {
    return this.primaryTransport;
  }
  getTransportByType(type) {
    return this.transports.get(type);
  }
  async send(nodeID, packet) {
    const transport = this.selectBestRoute(nodeID);
    return transport.send(nodeID, packet);
  }
  selectBestRoute(nodeID) {
    const node = this.node.registry.getNode(nodeID);
    if (!node || !node.addresses) return this.primaryTransport;
    for (const addr of node.addresses) {
      const type = this.getAddressType(addr);
      const t = this.transports.get(type);
      if (t) return t;
    }
    return this.primaryTransport;
  }
  getAddressType(address) {
    if (address.startsWith("tcp://")) return "tcp";
    if (address.startsWith("ws://") || address.startsWith("wss://")) return "ws";
    if (address.startsWith("nats://")) return "nats";
    if (address.startsWith("http://") || address.startsWith("https://")) return "http";
    return "ws";
  }
  async publish(topic, packet) {
    await this.primaryTransport.publish(topic, packet);
  }
  isConnected() {
    return Array.from(this.transports.values()).some((t) => t.isConnected());
  }
};

// src/core/NetworkDispatcher.ts
var NetworkDispatcher = class {
  constructor(logger, registry, nodeID, transportSend) {
    this.logger = logger;
    this.registry = registry;
    this.nodeID = nodeID;
    this.transportSend = transportSend;
  }
  logger;
  registry;
  nodeID;
  transportSend;
  handlers = /* @__PURE__ */ new Map();
  prefixHandlers = /* @__PURE__ */ new Map();
  /**
   * Register a handler for a specific topic or a topic prefix (using *).
   */
  on(topic, handler) {
    this.logger.debug(`[NetworkDispatcher] Registering handler for topic: ${topic}`);
    if (topic === "*") {
      const list = this.prefixHandlers.get("") || [];
      list.push(handler);
      this.prefixHandlers.set("", list);
    } else if (topic.endsWith("*")) {
      const prefix = topic.slice(0, -1);
      const list = this.prefixHandlers.get(prefix) || [];
      list.push(handler);
      this.prefixHandlers.set(prefix, list);
    } else {
      const list = this.handlers.get(topic) || [];
      list.push(handler);
      this.handlers.set(topic, list);
    }
  }
  /**
   * Dispatch an incoming packet to the registered handlers.
   */
  async dispatch(packet) {
    const isDirect = packet.topic === "__direct";
    let topic = packet.topic;
    let data = packet;
    if (isDirect) {
      const directData = packet.data;
      if (directData?.topic) {
        topic = directData.topic;
        data = directData.data;
      }
    } else if ("data" in packet) {
      data = packet.data;
    }
    if (!topic) {
      this.logger.warn("[NetworkDispatcher] Received packet without topic", { packet });
      return;
    }
    const exactHandlers = this.handlers.get(topic) || [];
    for (const handler of exactHandlers) {
      await handler(data, packet);
    }
    let handled = exactHandlers.length > 0;
    for (const [prefix, hList] of this.prefixHandlers.entries()) {
      if (prefix === "" || topic.startsWith(prefix)) {
        handled = true;
        for (const h of hList) {
          await h(data, packet);
        }
      }
    }
    if (!handled) {
      this.logger.debug(`[NetworkDispatcher] No handler registered for topic: ${topic}`, { internal: true });
    }
  }
  stop() {
    this.handlers.clear();
    this.prefixHandlers.clear();
  }
  hasHandler(topic) {
    if (this.handlers.has(topic)) return true;
    for (const prefix of this.prefixHandlers.keys()) {
      if (topic.startsWith(prefix)) return true;
    }
    return false;
  }
};

// src/core/NetworkController.ts
var NetworkController = class {
  constructor(node, logger) {
    this.node = node;
    this.logger = logger;
  }
  node;
  logger;
  registerHandlers(dispatcher) {
    dispatcher.on("$node.ping", (_data, packet) => this.handlePing(packet));
    dispatcher.on("$node.pong", (data, packet) => this.handlePong(data, packet));
    dispatcher.on("$node.pex", (data, _packet) => this.handlePex(data));
    dispatcher.on("$node.presence", (data, _packet) => this.handlePresence(data));
    dispatcher.on("$node.announce", (data, packet) => this.handleAnnounce(data, packet));
    dispatcher.on("$rpc.request", (data, packet) => this.handleRPCRequest(data, packet));
    dispatcher.on("$rpc.response", (data, packet) => this.handleRPCResponse(data, packet));
  }
  async handleAnnounce(data, packet) {
    if (packet.senderNodeID === this.node.nodeID) return;
    this.node.registry.registerNode({
      nodeID: packet.senderNodeID,
      type: "node",
      namespace: "default",
      // Ideally from data or config
      addresses: [],
      available: true,
      timestamp: Date.now(),
      nodeSeq: data.nodeSeq || 0,
      hostname: data.hostname || "unknown",
      services: data.services || [],
      trustLevel: "public",
      metadata: {},
      capabilities: {},
      pid: 0
    });
  }
  async handlePing(packet) {
    if (packet.senderNodeID === this.node.nodeID) return;
    this.node.registry.heartbeat(packet.senderNodeID);
    this.node.publish("$node.pong", { id: packet.id, timestamp: Date.now() });
  }
  async handlePong(_data, packet) {
    this.node.registry.heartbeat(packet.senderNodeID);
    this.logger.debug("Ping response received", { from: packet.senderNodeID, internal: true });
  }
  async handlePex(data) {
    if (this.node.orchestrator && data.peers) {
      this.node.orchestrator.handlePEX(data);
    }
  }
  async handlePresence(data) {
    this.logger.info(`HandlePresence called for node`, {
      hasOrchestrator: !!this.node.orchestrator,
      hasDataNode: !!data?.node,
      internal: true
    });
    if (this.node.orchestrator && data.node) {
      this.node.orchestrator.handlePresence(data);
    }
  }
  async handleRPCRequest(data, _packet) {
    this.logger.debug("Incoming RPC request", { action: data.action, internal: true });
  }
  async handleRPCResponse(_data, _packet) {
  }
};

// src/core/MeshOrchestrator.ts
var MeshOrchestrator = class {
  constructor(node, options = {}) {
    this.node = node;
    this.options = options;
    this.logger = node.logger.child({ name: "MeshOrchestrator" });
    this.node.registry.on("local:changed", () => {
      this.broadcastPresence();
    });
  }
  node;
  options;
  logger;
  gossipInterval;
  presenceInterval;
  async start() {
    this.logger.info(`MeshOrchestrator starting with ${this.options.bootstrapNodes?.length || 0} bootstrap nodes`);
    if (this.options.bootstrapNodes?.length) {
      await this.bootstrap();
    }
    this.gossipInterval = setInterval(() => this.gossipRound(), this.options.gossipIntervalMs || 1e4);
    SafeTimer.unref(this.gossipInterval);
    this.presenceInterval = setInterval(() => this.broadcastPresence(), 15e3);
    SafeTimer.unref(this.presenceInterval);
    this.broadcastPresence();
  }
  async stop() {
    if (this.gossipInterval) {
      SafeTimer.clearInterval(this.gossipInterval);
      this.gossipInterval = void 0;
    }
    if (this.presenceInterval) {
      SafeTimer.clearInterval(this.presenceInterval);
      this.presenceInterval = void 0;
    }
  }
  async bootstrap() {
    for (const addr of this.options.bootstrapNodes || []) {
      try {
        this.logger.info(`Bootstrapping from ${addr}`);
        await this.node.connectToPeer(`bootstrap_${Math.random().toString(36).substr(2, 5)}`, addr);
      } catch (err) {
        this.logger.warn(`Failed to bootstrap from ${addr}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  /**
   * Gossip Protocol: Periodically exchange known peer lists (PEX).
   */
  async gossipRound() {
    const nodes = this.node.registry.getAvailableNodes();
    if (nodes.length === 0) return;
    const target = nodes[Math.floor(Math.random() * nodes.length)];
    if (target.nodeID === this.node.nodeID) return;
    this.logger.debug(`Gossip: Exchanging peer list with ${target.nodeID}`, { internal: true });
    const allKnown = this.node.registry.getNodes();
    const subset = allKnown.sort(() => 0.5 - Math.random()).slice(0, 50);
    const peers = subset.map((n) => ({
      nodeID: n.nodeID,
      addresses: n.addresses,
      namespace: n.namespace,
      type: n.type,
      services: n.services,
      available: n.available,
      timestamp: n.timestamp,
      nodeSeq: n.nodeSeq,
      nodeType: n.nodeType,
      parentID: n.parentID
    }));
    this.node.publish("$node.pex", { peers }).catch(() => {
    });
  }
  async broadcastPresence(targetNodeID) {
    const localNode = this.node.registry.getNode(this.node.nodeID);
    if (!localNode) return;
    try {
      this.logger.info(`Broadcasting presence for ${this.node.nodeID}${targetNodeID ? ` to ${targetNodeID}` : ""}...`);
      await this.node.send(targetNodeID || "*", "$node.presence", {
        node: localNode
      });
    } catch (err) {
      this.logger.warn(`Failed to broadcast presence to ${targetNodeID || "*"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  /**
   * Immediate Peer Reconstruction:
   * When a peer connects, send them our presence AND our full peer list (PEX).
   */
  async handlePeerConnect(nodeID) {
    try {
      this.logger.info(`[MeshOrchestrator] Peer connected: ${nodeID}. Sending immediate presence and PEX.`);
      await this.broadcastPresence(nodeID);
      const allKnown = this.node.registry.getNodes();
      const peers = allKnown.map((n) => ({
        nodeID: n.nodeID,
        addresses: n.addresses,
        namespace: n.namespace,
        type: n.type,
        services: n.services,
        available: n.available,
        timestamp: n.timestamp,
        nodeSeq: n.nodeSeq,
        nodeType: n.nodeType,
        parentID: n.parentID
      }));
      await this.node.send(nodeID, "$node.pex", { peers });
    } catch (err) {
      this.logger.warn(`Error during peer reconstruction for ${nodeID}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  /**
   * Immediate Peer Removal:
   * When a transport detects a disconnect, remove the node immediately.
   */
  async handlePeerDisconnect(nodeID) {
    this.logger.info(`[MeshOrchestrator] Peer disconnected: ${nodeID}. Removing from registry.`);
    this.node.registry.unregisterNode(nodeID);
  }
  /**
   * Handles incoming Peer Exchange (PEX) data.
   */
  async handlePEX(data) {
    if (!data.peers || !Array.isArray(data.peers)) return;
    for (const peer of data.peers) {
      const p = peer;
      if (!p.nodeID || p.nodeID === this.node.nodeID) continue;
      this.node.registry.registerNode(p);
    }
  }
  async handlePresence(data) {
    if (!data.node || data.node.nodeID === this.node.nodeID) return;
    const isNew = !this.node.registry.getNode(data.node.nodeID);
    this.logger.debug(`Presence: Discovered node ${data.node.nodeID}`, {
      serviceCount: data.node.services.length,
      internal: true
    });
    this.node.registry.registerNode(data.node);
    if (isNew) {
      await this.broadcastPresence(data.node.nodeID);
    }
  }
};

// src/utils/Env.ts
var Env = class {
  static isNode() {
    return typeof process !== "undefined" && process.versions != null && process.versions.node != null;
  }
  static isBrowser() {
    return typeof window !== "undefined" && typeof window.document !== "undefined";
  }
};

// src/core/UnifiedServer.ts
var UnifiedServer = class {
  app = null;
  server = null;
  port;
  listening = false;
  constructor(port = 0) {
    this.port = port;
  }
  async init() {
    if (this.server || !Env.isNode()) return;
    try {
      const express = await import("express");
      const http = await import("node:http");
      const appFactory = express.default || express;
      this.app = appFactory();
      this.server = http.createServer(this.app);
    } catch {
    }
  }
  getApp() {
    return this.app;
  }
  getServer() {
    return this.server;
  }
  getPort() {
    return this.port;
  }
  async listen() {
    if (!Env.isNode() || this.listening) return this.port;
    await this.init();
    if (!this.server) return null;
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, () => {
        const addr = this.server.address();
        if (addr && typeof addr === "object") this.port = addr.port;
        this.listening = true;
        resolve(this.port);
      });
      this.server.on("error", reject);
    });
  }
  async stop() {
    if (!this.listening || !this.server) return;
    return new Promise((resolve) => {
      this.server.close(() => {
        this.listening = false;
        resolve();
      });
    });
  }
};

// src/core/MeshNetwork.ts
var MeshNetwork = class extends import_index.default {
  nodeID;
  namespace;
  logger;
  registry;
  transport;
  dispatcher;
  controller;
  orchestrator;
  server = null;
  interceptors = [];
  options;
  // Packet Deduplication Cache (Phase 1)
  seenPackets = /* @__PURE__ */ new Map();
  PACKET_TTL_MS = 1e4;
  cleanupTimer;
  constructor(options, logger, registry) {
    super();
    this.options = options;
    this.nodeID = options.nodeId || `node_${Math.random().toString(36).substr(2, 9)}`;
    this.namespace = options.namespace || "default";
    this.logger = logger;
    this.registry = registry;
    if (Env.isNode() && options.port !== void 0) {
      this.server = new UnifiedServer(options.port);
    }
    this.orchestrator = new MeshOrchestrator(this, {
      bootstrapNodes: options.bootstrapNodes
    });
    this.transport = new TransportManager({ transports: options.transports }, this);
    this.dispatcher = new NetworkDispatcher(
      this.logger,
      this.registry,
      this.nodeID,
      (nodeID, packet) => this.transport.send(nodeID, packet)
    );
    this.controller = new NetworkController(this, this.logger);
    this.controller.registerHandlers(this.dispatcher);
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, expiry] of this.seenPackets.entries()) {
        if (now > expiry) {
          this.seenPackets.delete(id);
        }
      }
    }, 5e3);
    SafeTimer.unref(this.cleanupTimer);
    this.transport.on("packet", async (packet) => {
      const now = Date.now();
      const isResponse = packet.type === "RESPONSE" || packet.type === "RESPONSE_ERROR";
      const isFromSelf = packet.senderNodeID === this.nodeID;
      if (isFromSelf) {
        return;
      }
      if (packet.namespace && packet.namespace !== this.namespace) {
        return;
      }
      if (!isResponse && this.seenPackets.has(packet.id)) {
        return;
      }
      if (!isResponse) {
        this.seenPackets.set(packet.id, now + this.PACKET_TTL_MS);
      }
      this.logger.debug(`[MeshNetwork] Packet accepted: ${packet.topic} from ${packet.senderNodeID} (Type: ${packet.type})`, { internal: true });
      if (packet.senderNodeID) {
        this.registry.heartbeat(packet.senderNodeID);
      }
      let processedData = packet;
      for (const interceptor of [...this.interceptors].reverse()) {
        if (interceptor.onInbound) {
          processedData = await interceptor.onInbound(processedData);
        }
      }
      for (const handler of this.anyPacketHandlers) {
        try {
          handler(processedData.data, processedData);
        } catch (err) {
          this.logger.error("[MeshNetwork] Error in generic packet handler", { error: err });
        }
      }
      await this.dispatcher.dispatch(processedData);
      if (processedData.type === "EVENT" && processedData.topic !== "__forwarded" && processedData.topic !== "__dropped") {
        await this.forwardEvent(processedData);
      }
    });
  }
  /**
   * Standardized Event Forwarding (Phase 2)
   */
  async forwardEvent(packet) {
    const currentTtl = packet.meta?.ttl ?? 5;
    if (currentTtl <= 1) {
      this.logger.debug(`[MeshNetwork] Packet ${packet.id} dropped: TTL reached 1 or 0`);
      return;
    }
    const path = packet.meta?.path || [];
    const forwardedPacket = {
      ...packet,
      meta: {
        ...packet.meta,
        ttl: currentTtl - 1,
        path: [...path, this.nodeID]
      }
    };
    const peers = this.registry.getAvailableNodes();
    const targets = peers.filter((p) => {
      if (p.nodeID === this.nodeID) return false;
      if (p.nodeID === packet.senderNodeID) return false;
      const inPath = path.includes(p.nodeID);
      if (inPath) {
        this.logger.debug(`[MeshNetwork] Skipping node ${p.nodeID} for packet ${packet.id} (already in path)`);
      }
      return !inPath;
    });
    for (const target of targets) {
      try {
        await this.transport.send(target.nodeID, forwardedPacket);
      } catch (err) {
        this.logger.error(`[MeshNetwork] Failed to forward event ${packet.id} to ${target.nodeID}:`, {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  }
  use(interceptor) {
    this.interceptors.push(interceptor);
  }
  async start() {
    this.logger.info(`[MeshNetwork] Starting node ${this.nodeID}...`);
    let port = this.options.port;
    if (this.server) {
      await this.server.listen();
      port = this.server.getPort();
      const localNode = this.registry.getNode(this.nodeID);
      if (localNode) {
        localNode.addresses = [`ws://127.0.0.1:${port}`];
        this.registry.registerNode(localNode);
      }
    }
    await this.transport.connect({
      nodeID: this.nodeID,
      namespace: this.namespace,
      logger: this.logger,
      url: this.options.bootstrapNodes?.[0],
      // Use primary bootstrap node as connection URL
      port,
      registry: this.registry,
      sharedServer: this.server?.getServer() ?? void 0
    });
    await this.orchestrator.start();
  }
  async connectToPeer(nodeID, url) {
    return this.transport.getTransport().connectToPeer(nodeID, url);
  }
  async stop() {
    await this.orchestrator.stop();
    await this.transport.disconnect();
    for (const interceptor of this.interceptors) {
      if (interceptor.stop) {
        await interceptor.stop();
      }
    }
    this.dispatcher.stop();
    if (this.server) {
      await this.server.stop();
    }
  }
  async send(targetNodeID, topic, data, options) {
    if (targetNodeID === "*") {
      if (options?.type === "REQUEST") {
        throw new Error("[MeshNetwork] Cannot broadcast REQUEST packets. Use a specific targetNodeID or the Service Broker.");
      }
      return this.publish(topic, data);
    }
    try {
      let priority = options?.priority ?? 1;
      if (topic.startsWith("raft.") || topic.startsWith("kademlia.")) {
        priority = 2;
      }
      const primaryTransport = this.transport.getTransport();
      const packet = {
        topic,
        data: options?.error ? void 0 : data,
        error: options?.error,
        id: options?.id || `mesh_${Math.random().toString(36).substr(2, 9)}`,
        type: options?.type || "EVENT",
        senderNodeID: this.nodeID,
        namespace: this.namespace,
        timestamp: Date.now(),
        version: primaryTransport.version,
        priority,
        meta: {
          ttl: 5,
          path: [this.nodeID],
          ...options?.meta
        }
      };
      let processedPacket = packet;
      for (const interceptor of this.interceptors) {
        if (interceptor.onOutbound) {
          processedPacket = await interceptor.onOutbound(processedPacket);
        }
      }
      if (processedPacket.topic === "__circuit_open") {
        throw new Error(`Circuit open for node ${targetNodeID}`);
      }
      await this.transport.send(targetNodeID, processedPacket);
    } catch (err) {
      this.logger.error(`[MeshNetwork] Failed to send to ${targetNodeID}:`, {
        error: err instanceof Error ? err.message : String(err)
      });
      if (err instanceof Error && err.message.includes("Circuit open")) throw err;
    }
  }
  async publish(topic, data) {
    try {
      let priority = 1;
      if (topic.startsWith("raft.") || topic.startsWith("kademlia.")) {
        priority = 2;
      }
      const primaryTransport = this.transport.getTransport();
      const packet = {
        topic,
        data,
        id: `mesh_${Math.random().toString(36).substr(2, 9)}`,
        type: "EVENT",
        senderNodeID: this.nodeID,
        namespace: this.namespace,
        timestamp: Date.now(),
        version: primaryTransport.version,
        priority,
        meta: {
          ttl: 5,
          path: [this.nodeID]
        }
      };
      return await this.transport.publish(topic, packet);
    } catch (err) {
      this.logger.error(`[MeshNetwork] Failed to publish to ${topic}:`, {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  /**
   * Internal: Handles incoming packets from local sources (Broker loopback).
   */
  handleIncoming(topic, data, options) {
    this.logger.debug(`[MeshNetwork] handleIncoming for topic: ${topic}`);
    const packet = {
      id: options?.id || `local_${Math.random().toString(36).substr(2, 9)}`,
      topic,
      data,
      type: options?.type || "EVENT",
      senderNodeID: options?.senderNodeID || this.nodeID,
      timestamp: Date.now(),
      version: 1,
      priority: 1,
      meta: { ...options?.meta, local: true }
    };
    this.dispatcher.dispatch(packet).then(() => {
      this.logger.debug(`[MeshNetwork] Local dispatch complete for topic: ${topic}`);
    }).catch((err) => {
      this.logger.error(`[MeshNetwork] Local dispatch error:`, {
        topic,
        error: err instanceof Error ? err.message : String(err)
      });
    });
  }
  anyPacketHandlers = [];
  onMessage(topic, handler) {
    if (topic === "*") {
      this.anyPacketHandlers.push(handler);
    } else {
      this.dispatcher.on(topic, handler);
    }
  }
  unsubscribe(topic, handler) {
    if (topic === "*") {
      this.anyPacketHandlers = this.anyPacketHandlers.filter((h) => h !== handler);
    }
  }
};

// src/transports/BaseTransport.ts
var BaseTransport = class extends import_index.default {
  serializer;
  connected = false;
  nodeID = "unknown";
  subscriptions = /* @__PURE__ */ new Map();
  constructor(serializer) {
    super();
    this.serializer = serializer;
  }
  /** Post-connection initialization (optional) */
  async start() {
  }
  /** Establish a direct peer connection (optional implementation) */
  async connectToPeer(_nodeID, _url, _options) {
    throw new Error(`Transport ${this.protocol} does not support direct peer connections`);
  }
  /** Subscribe to a topic / channel */
  async subscribe(topic) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, []);
    }
  }
  /** Add a handler callback for a topic */
  addHandler(topic, handler) {
    const handlers = this.subscriptions.get(topic) ?? [];
    handlers.push(handler);
    this.subscriptions.set(topic, handlers);
  }
  isConnected() {
    return this.connected;
  }
  /** Returns the actual bound port (if applicable) */
  getPort() {
    return 0;
  }
};

// src/utils/OfflineStorageEngine.ts
var OfflineStorageEngine = class {
  db = null;
  DB_NAME = "isomorphic_mesh_offline";
  STORE_NAME = "rpc_queue";
  async init() {
    if (!Env.isBrowser()) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);
      request.onupgradeneeded = (event) => {
        const req = event.target;
        const db = req.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = (event) => {
        const req = event.target;
        this.db = req.result;
        resolve();
      };
      request.onerror = (event) => {
        const req = event.target;
        reject(new Error(`IndexedDB error: ${req.error}`));
      };
    });
  }
  async queue(rpc) {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORE_NAME], "readwrite");
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.add(rpc);
      request.onsuccess = () => resolve();
      request.onerror = (event) => {
        const req = event.target;
        reject(req.error);
      };
    });
  }
  async getAll() {
    if (!this.db) return [];
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORE_NAME], "readonly");
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.getAll();
      request.onsuccess = (event) => {
        const req = event.target;
        resolve(req.result);
      };
      request.onerror = (event) => {
        const req = event.target;
        reject(req.error);
      };
    });
  }
  async remove(id) {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORE_NAME], "readwrite");
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = (event) => {
        const req = event.target;
        reject(req.error);
      };
    });
  }
  async clear() {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.STORE_NAME], "readwrite");
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = (event) => {
        const req = event.target;
        reject(req.error);
      };
    });
  }
};

// src/transports/browser/BrowserWebSocketTransport.ts
var BrowserWebSocketTransport = class _BrowserWebSocketTransport extends BaseTransport {
  protocol = "ws";
  version = 1;
  ws = null;
  peers = /* @__PURE__ */ new Map();
  logger;
  pendingRPCs = /* @__PURE__ */ new Map();
  static RPC_TIMEOUT_MS = 1e4;
  reconnectAttempts = 0;
  static MAX_RECONNECT_ATTEMPTS = 10;
  offlineStorage = new OfflineStorageEngine();
  reconnectionTimers = /* @__PURE__ */ new Set();
  constructor(serializer) {
    super(serializer);
  }
  async connect(opts) {
    this.nodeID = opts.nodeID || this.nodeID;
    this.logger = opts.logger;
    const url = opts.url;
    await this.offlineStorage.init();
    if (url) {
      await this.internalConnectToPeer("gateway", url);
    }
    this.connected = true;
    this.emit("connected");
  }
  async disconnect() {
    for (const timer of this.reconnectionTimers) {
      SafeTimer.clearTimeout(timer);
    }
    this.reconnectionTimers.clear();
    for (const pending of this.pendingRPCs.values()) {
      SafeTimer.clearTimeout(pending.timeout);
      pending.reject(new Error("Transport disconnected"));
    }
    this.pendingRPCs.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const ws of this.peers.values()) {
      ws.close();
    }
    this.peers.clear();
    this.connected = false;
    this.emit("disconnected");
  }
  async send(nodeID, packet) {
    const ws = this.peers.get(nodeID) || this.ws;
    if (!ws || ws.readyState !== 1) {
      if (packet.type === "REQUEST") {
        await this.offlineStorage.queue({
          id: packet.id || nanoid(),
          targetId: nodeID,
          topic: packet.topic,
          data: packet.data,
          timestamp: Date.now()
        });
        return;
      }
      return;
    }
    const correlationId = packet.id || nanoid();
    const buf = this.serializer.serialize({ ...packet, senderNodeID: this.nodeID, id: correlationId });
    ws.send(new TextDecoder().decode(buf));
  }
  async call(nodeID, topic, data) {
    const id = nanoid();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pendingRPCs.has(id)) {
          this.pendingRPCs.delete(id);
          reject(new Error(`RPC timeout after ${_BrowserWebSocketTransport.RPC_TIMEOUT_MS}ms`));
        }
      }, _BrowserWebSocketTransport.RPC_TIMEOUT_MS);
      SafeTimer.unref(timeout);
      this.pendingRPCs.set(id, { resolve, reject, timeout });
      this.send(nodeID, { topic, data, id, type: "REQUEST", senderNodeID: this.nodeID, timestamp: Date.now() }).catch((err) => {
        SafeTimer.clearTimeout(timeout);
        this.pendingRPCs.delete(id);
        reject(err);
      });
    });
  }
  async publish(topic, packet) {
    if (packet.type === "REQUEST") {
      this.logger?.warn(`[WSTransport] Cannot broadcast REQUEST packets to topic: ${topic}`);
      return;
    }
    const buf = this.serializer.serialize(packet);
    const payload = new TextDecoder().decode(buf);
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(payload);
    }
    for (const ws of this.peers.values()) {
      if (ws.readyState === 1) {
        ws.send(payload);
      }
    }
  }
  async connectToPeer(nodeID, url) {
    return this.internalConnectToPeer(nodeID, url);
  }
  async internalConnectToPeer(nodeID, url, attempt = 0) {
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        ws.onopen = () => {
          this.reconnectAttempts = 0;
          if (nodeID === "gateway") this.ws = ws;
          this.peers.set(nodeID, ws);
          this.emit("peer:connect", nodeID);
          this.replayQueuedRPCs(nodeID);
          resolve();
        };
        ws.onerror = (err) => {
          if (attempt === 0) reject(err);
        };
        ws.onmessage = (event) => {
          this.handleIncomingMessage(event.data, ws);
        };
        ws.onclose = () => {
          if (nodeID === "gateway") this.ws = null;
          this.peers.delete(nodeID);
          this.emit("peer:disconnect", nodeID);
          this.handleReconnection(nodeID, url);
        };
      } catch (err) {
        reject(err);
      }
    });
  }
  handleIncomingMessage(raw, _socket) {
    try {
      const envelope = this.serializer.deserialize(raw);
      const { topic, data, id, type, senderNodeID } = envelope;
      if (senderNodeID && !this.peers.has(senderNodeID) && senderNodeID !== this.nodeID) {
        this.peers.set(senderNodeID, _socket);
        this.emit("peer:connect", senderNodeID);
      }
      if (type === "RESPONSE" || type === "RESPONSE_ERROR") {
        const pending = this.pendingRPCs.get(id);
        if (pending) {
          SafeTimer.clearTimeout(pending.timeout);
          this.pendingRPCs.delete(id);
          if (envelope.type === "RESPONSE_ERROR") {
            pending.reject(new Error(envelope.error?.message || "RPC Error"));
          } else if (envelope.type === "RESPONSE") {
            pending.resolve(envelope.data);
          }
          return;
        }
      }
      const handlers = this.subscriptions.get(topic) || [];
      for (const handler of handlers) {
        handler(data);
      }
      this.emit("packet", envelope);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }
  async replayQueuedRPCs(nodeID) {
    const queued = await this.offlineStorage.getAll();
    for (const rpc of queued) {
      if (rpc.targetId === nodeID) {
        this.send(nodeID, {
          id: rpc.id,
          topic: rpc.topic,
          data: rpc.data,
          type: "REQUEST",
          senderNodeID: this.nodeID,
          timestamp: rpc.timestamp
        }).then(() => {
          this.offlineStorage.remove(rpc.id);
        }).catch(() => {
        });
      }
    }
  }
  handleReconnection(nodeID, url) {
    if (this.reconnectAttempts >= _BrowserWebSocketTransport.MAX_RECONNECT_ATTEMPTS) {
      this.logger?.error(`Max reconnection attempts reached for node ${nodeID}`);
      return;
    }
    const delay = Math.min(3e4, Math.pow(2, this.reconnectAttempts) * 1e3);
    this.reconnectAttempts++;
    const timer = setTimeout(() => {
      this.reconnectionTimers.delete(timer);
      this.internalConnectToPeer(nodeID, url, this.reconnectAttempts).catch(() => {
      });
    }, delay);
    this.reconnectionTimers.add(timer);
    SafeTimer.unref(timer);
  }
};

// src/serializers/BaseSerializer.ts
var BaseSerializer = class {
};

// src/serializers/JSONSerializer.ts
var JSONSerializer = class extends BaseSerializer {
  type = "json";
  encoder = new TextEncoder();
  decoder = new TextDecoder();
  serialize(data) {
    return this.encoder.encode(JSON.stringify(data, (key, value) => {
      if (value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
        return value;
      }
      if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
        return { type: "Buffer", data: Array.from(value) };
      }
      return value;
    }));
  }
  deserialize(raw) {
    let str;
    if (typeof raw === "string") {
      str = raw;
    } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
      str = raw.toString("utf-8");
    } else {
      str = this.decoder.decode(raw);
    }
    return JSON.parse(str, (key, value) => {
      if (value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
        return Buffer.from(value.data);
      }
      return value;
    });
  }
  isBuffer(raw) {
    return typeof Buffer !== "undefined" && Buffer.isBuffer(raw);
  }
};

// demo-browser/app.ts
var output = document.getElementById("output");
var btn = document.getElementById("run-btn");
var input = document.getElementById("name-input");
var log = (msg) => {
  output.textContent += msg + "\n";
  output.scrollTop = output.scrollHeight;
};
try {
  log("Initializing MeshApp in Browser...");
  const app = createMeshApp({ nodeID: "browser-client" });
  const broker = new ServiceBroker(app);
  const registry = new ServiceRegistry(app.logger);
  app.registerProvider("broker", broker);
  app.registerProvider("registry", registry);
  broker.setRegistry(registry);
  const RegistryPlugin2 = (await Promise.resolve().then(() => (init_RegistryPlugin(), RegistryPlugin_exports))).RegistryPlugin;
  broker.pipe(new RegistryPlugin2(registry));
  const network = new MeshNetwork({
    bootstrapNodes: ["ws://localhost:3000"],
    transports: [new BrowserWebSocketTransport(new JSONSerializer())]
  }, app.logger, registry);
  broker.setNetwork(network);
  await app.start();
  await network.start();
  log("Connected to Mesh Network!");
  const client = new MeshClient(app);
  btn.addEventListener("click", async () => {
    const name = input.value || "Anonymous";
    log(`
Executing api.demo.hello({ name: "${name}" }) via SDK...`);
    btn.disabled = true;
    try {
      const result = await client.api.demo.hello({ name }, { nodeID: "demo-node-1" });
      log(`Server Response: ${JSON.stringify(result, null, 2)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Error: ${message}`);
    } finally {
      btn.disabled = false;
    }
  });
} catch (err) {
  log(`Failed to initialize: ${err}`);
}

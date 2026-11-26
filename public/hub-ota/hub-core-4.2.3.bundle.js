#!/usr/bin/env node
/* Saimetric Local Hub Core OTA Bundle v4.2.3 — Built 2026-11-26T10:33:01.120Z */
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module2.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/ws/lib/buffer-util.js"(exports2, module2) {
    "use strict";
    var { websocketMask, websocketUnmask } = require("http");
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (websocketMask) {
      module2.exports.mask = function(source, mask, output, offset, length) {
        if (length < 24) _mask(source, mask, output, offset, length);
        else websocketMask(source, mask, output, offset, length);
      };
      module2.exports.unmask = function(buffer, mask) {
        if (buffer.length < 24) _unmask(buffer, mask);
        else websocketUnmask(buffer, mask);
      };
    } else if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require("bufferutil");
        module2.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module2.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32) _unmask(buffer, mask);
          else bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/ws/lib/limiter.js"(exports2, module2) {
    "use strict";
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module2.exports = Limiter;
  }
});

// node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && (typeof params.client_max_window_bits === "number" ? opts.clientMaxWindowBits > params.client_max_window_bits : !params.client_max_window_bits)) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module2.exports = PerMessageDeflate;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    var { isUtf8 } = require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require("utf-8-validate");
        module2.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    var { Writable } = require("stream");
    var PerMessageDeflate = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxBufferedChunks = options.maxBufferedChunks | 0;
        this._maxFragments = options.maxFragments | 0;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._numFragments = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
          cb(
            this.createError(
              RangeError,
              "Too many buffered chunks",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            )
          );
          return;
        }
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        this._mask = void 0;
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
          const error = this.createError(
            RangeError,
            "Too many message fragments",
            false,
            1008,
            "WS_ERR_TOO_MANY_BUFFERED_PARTS"
          );
          cb(error);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._numFragments = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module2.exports = Receiver;
  }
});

// node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var {
      types: { isUint8Array }
    } = require("util");
    var PerMessageDeflate = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) {
          return dataLength ? [target, data] : [target];
        }
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (!dataLength) return [target];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else if (isUint8Array(data)) {
            buf.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module2.exports = Sender;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/ws/lib/event-target.js"(exports2, module2) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module2.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/ws/lib/extension.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension) => {
        let configurations = extensions[extension];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module2.exports = { format, parse };
  }
});

// node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var https = require("https");
    var http2 = require("http");
    var net = require("net");
    var querystring = require("querystring");
    var tls = require("tls");
    var { randomBytes, createHash } = require("crypto");
    var { Duplex, Readable } = require("stream");
    var { URL: URL2 } = require("url");
    var PerMessageDeflate = require_permessage_deflate();
    var Receiver = require_receiver();
    var Sender = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            if (!options || options.protocols === void 0) {
              protocols = [];
            } else if (Array.isArray(options.protocols)) {
              protocols = options.protocols;
            } else {
              protocols = [options.protocols];
            }
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              if (options.protocols === void 0) {
                protocols = [];
              } else if (Array.isArray(options.protocols)) {
                protocols = options.protocols;
              } else {
                protocols = [options.protocols];
              }
            } else {
              protocols = [protocols];
            }
          }
          options = initAsClient(this, address, protocols, options);
        } else {
          this._isServer = true;
        }
        if (options.autoPong) {
          this._autoPong = true;
          this._autoPongComplete = () => autoPongComplete(this);
          this._pendingAutoPongs = 0;
          this._maxPendingAutoPongs = options.maxPendingAutoPongs | 0;
        }
        this._closeTimeout = options.closeTimeout;
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxBufferedChunks: options.maxBufferedChunks,
          maxFragments: options.maxFragments,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate.extensionName]) {
          this._extensions[PerMessageDeflate.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        this._readyState = _WebSocket.CLOSING;
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module2.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxBufferedChunks: 256 * 1024,
        maxFragments: 16 * 1024,
        maxPayload: 100 * 1024 * 1024,
        maxPendingAutoPongs: 60,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        protocols: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
        parsedUrl = new URL2(parsedUrl);
        parsedUrl.protocol = parsedUrl.protocol === "http:" ? "ws:" : "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http2.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        const username = querystring.unescape(parsedUrl.username);
        const password = querystring.unescape(parsedUrl.password);
        opts.auth = `${username}:${password}`;
      }
      if (isIpcUrl) {
        const i = opts.path.indexOf(":");
        if (i === -1) {
          opts.socketPath = opts.path;
          opts.path = "";
        } else {
          opts.socketPath = opts.path.slice(0, i);
          opts.path = opts.path.slice(i + 1);
        }
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxBufferedChunks: opts.maxBufferedChunks,
          maxFragments: opts.maxFragments,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
      return opts;
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeCode = code;
      if (reason.length === 0) {
        websocket._closeMessage = EMPTY_BUFFER;
      } else {
        websocket._closeMessage = Buffer.allocUnsafeSlow(reason.length);
        websocket._closeMessage.set(reason);
      }
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong && websocket.readyState === WebSocket2.OPEN) {
        if (websocket._maxPendingAutoPongs > 0 && websocket._pendingAutoPongs >= websocket._maxPendingAutoPongs) {
          websocket.terminate();
        } else {
          websocket._pendingAutoPongs++;
          websocket.pong(data, !this._isServer, websocket._autoPongComplete);
        }
      }
      websocket.emit("ping", data);
    }
    function autoPongComplete(websocket) {
      websocket._pendingAutoPongs--;
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module2.exports = createWebSocketStream;
  }
});

// node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/ws/lib/subprotocol.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module2.exports = { parse };
  }
});

// node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var http2 = require("http");
    var { Duplex } = require("stream");
    var { createHash } = require("crypto");
    var extension = require_extension();
    var PerMessageDeflate = require_permessage_deflate();
    var subprotocol = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=16384] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Number} [options.maxPendingAutoPongs=60] The maximum number of
       *     pending automatic pongs
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxBufferedChunks: 256 * 1024,
          maxFragments: 16 * 1024,
          maxPayload: 100 * 1024 * 1024,
          maxPendingAutoPongs: 60,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http2.createServer((req, res) => {
            const body = http2.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server2 = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server2.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate.extensionName]);
              extensions[PerMessageDeflate.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate.extensionName]) {
          const params = extensions[PerMessageDeflate.extensionName].params;
          const value = extension.format({
            [PerMessageDeflate.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxBufferedChunks: this.options.maxBufferedChunks,
          maxFragments: this.options.maxFragments,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module2.exports = WebSocketServer2;
    function addListeners(server2, map) {
      for (const event of Object.keys(map)) server2.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server2.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server2) {
      server2._state = CLOSED;
      server2.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http2.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http2.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server2, req, socket, code, message, headers) {
      if (server2.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server2.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// node_modules/ws/index.js
var require_ws = __commonJS({
  "node_modules/ws/index.js"(exports2, module2) {
    "use strict";
    var createWebSocketStream = require_stream();
    var extension = require_extension();
    var PerMessageDeflate = require_permessage_deflate();
    var Receiver = require_receiver();
    var Sender = require_sender();
    var subprotocol = require_subprotocol();
    var WebSocket2 = require_websocket();
    var WebSocketServer2 = require_websocket_server();
    WebSocket2.createWebSocketStream = createWebSocketStream;
    WebSocket2.extension = extension;
    WebSocket2.PerMessageDeflate = PerMessageDeflate;
    WebSocket2.Receiver = Receiver;
    WebSocket2.Sender = Sender;
    WebSocket2.Server = WebSocketServer2;
    WebSocket2.subprotocol = subprotocol;
    WebSocket2.WebSocket = WebSocket2;
    WebSocket2.WebSocketServer = WebSocketServer2;
    module2.exports = WebSocket2;
  }
});

// public/termux-hub.js
var { WebSocketServer, WebSocket } = require_ws();
var http = require("http");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var os = require("os");
var portArgIdx = process.argv.indexOf("--port");
var PORT = portArgIdx !== -1 && process.argv[portArgIdx + 1] ? parseInt(process.argv[portArgIdx + 1], 10) : parseInt(process.env.PORT || "8080", 10);
var branchIdArgIdx = process.argv.indexOf("--branch-id");
var hubBranchId = branchIdArgIdx !== -1 && process.argv[branchIdArgIdx + 1] ? process.argv[branchIdArgIdx + 1] : process.env.HUB_BRANCH_ID || "BR-HARARE";
var branchNameArgIdx = process.argv.indexOf("--branch-name");
var hubBranchName = branchNameArgIdx !== -1 && process.argv[branchNameArgIdx + 1] ? process.argv[branchNameArgIdx + 1] : process.env.HUB_BRANCH_NAME || "Harare Main";
var tenantIdArgIdx = process.argv.indexOf("--tenant-id");
var hubTenantId = tenantIdArgIdx !== -1 && process.argv[tenantIdArgIdx + 1] ? process.argv[tenantIdArgIdx + 1] : process.env.HUB_TENANT_ID || "COMP-001";
var HUB_VERSION = "4.2.3";
var HUB_RUNTIME = String(process.env.HUB_RUNTIME || "TERMUX").toUpperCase() === "ANDROID_APK" ? "ANDROID_APK" : "TERMUX";
var HUB_OTA_SLOT = String(process.env.HUB_OTA_SLOT || (HUB_RUNTIME === "ANDROID_APK" ? "A" : "TERMUX"));
var HUB_REQUIRE_AUTH = process.argv.includes("--require-auth") || String(process.env.HUB_REQUIRE_AUTH || "").toLowerCase() === "true" || HUB_RUNTIME === "ANDROID_APK" && String(process.env.HUB_REQUIRE_AUTH || "").toLowerCase() !== "false";
var mdnsHostArgIdx = process.argv.indexOf("--mdns-host");
var HUB_MDNS_HOST = (mdnsHostArgIdx !== -1 && process.argv[mdnsHostArgIdx + 1] ? process.argv[mdnsHostArgIdx + 1] : process.env.HUB_MDNS_HOST || "").trim().toLowerCase();
function getHubLanIps() {
  try {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const ifaceList of Object.values(nets || {})) {
      if (!Array.isArray(ifaceList)) continue;
      for (const iface of ifaceList) {
        if (!iface || iface.internal) continue;
        const family = typeof iface.family === "string" ? iface.family : String(iface.family);
        if ((family === "IPv4" || family === "4") && iface.address && !ips.includes(iface.address)) {
          ips.push(iface.address);
        }
      }
    }
    return ips;
  } catch {
    return [];
  }
}
function getHubMdnsHost() {
  if (HUB_MDNS_HOST) return HUB_MDNS_HOST;
  if (typeof hubSecurityState !== "undefined" && hubSecurityState && hubSecurityState.hubId) {
    return `${String(hubSecurityState.hubId).toLowerCase()}.local`;
  }
  return "";
}
var roleArgIdx = process.argv.indexOf("--role");
function normalizeTermuxHubRole(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (s === "BACKUP") return "BACKUP";
  if (s === "TILL_FALLBACK" || s === "TILL") return "TILL_FALLBACK";
  return "PRIMARY";
}
function defaultTermuxHubPriority(role) {
  if (role === "BACKUP") return 50;
  if (role === "TILL_FALLBACK") return 10;
  return 100;
}
var hubRole = normalizeTermuxHubRole(
  roleArgIdx !== -1 && process.argv[roleArgIdx + 1] ? process.argv[roleArgIdx + 1] : process.env.HUB_ROLE || "PRIMARY"
);
var priorityArgIdx = process.argv.indexOf("--priority");
var rawPriority = priorityArgIdx !== -1 && process.argv[priorityArgIdx + 1] ? Number(process.argv[priorityArgIdx + 1]) : Number(process.env.HUB_PRIORITY);
var hubPriority = Number.isFinite(rawPriority) && rawPriority > 0 ? Math.floor(rawPriority) : defaultTermuxHubPriority(hubRole);
var epochArgIdx = process.argv.indexOf("--epoch");
var rawEpoch = epochArgIdx !== -1 && process.argv[epochArgIdx + 1] ? Number(process.argv[epochArgIdx + 1]) : Number(process.env.HUB_BRANCH_EPOCH);
var hubBranchEpoch = Number.isFinite(rawEpoch) && rawEpoch >= 1 ? Math.floor(rawEpoch) : 1;
var modeArgIdx = process.argv.indexOf("--mode");
var hubMode = String(
  modeArgIdx !== -1 && process.argv[modeArgIdx + 1] ? process.argv[modeArgIdx + 1] : process.env.HUB_MODE || "ACTIVE"
).trim().toUpperCase() === "STANDBY" ? "STANDBY" : "ACTIVE";
var activeLeaderHubId = null;
var activeLeaderInfo = null;
function isHubCold() {
  return typeof salesStore !== "undefined" && typeof inventoryStore !== "undefined" && Array.isArray(salesStore) && Array.isArray(inventoryStore) && salesStore.length === 0 && inventoryStore.length === 0;
}
function getHubFailoverMeta() {
  const selfId = typeof hubSecurityState !== "undefined" && hubSecurityState && hubSecurityState.hubId ? hubSecurityState.hubId : null;
  const ips = getHubLanIps();
  const primaryLanIp = ips[0] || "127.0.0.1";
  const effectiveLeaderId = hubMode === "ACTIVE" ? selfId : activeLeaderHubId;
  const effectiveLeaderInfo = hubMode === "ACTIVE" && selfId ? {
    hubId: selfId,
    hubRole,
    hubPriority,
    branchEpoch: hubBranchEpoch,
    lanIp: primaryLanIp,
    wsPort: PORT,
    wsUrl: `ws://${primaryLanIp}:${PORT}`
  } : activeLeaderInfo;
  return {
    hubRole,
    hubPriority,
    branchEpoch: hubBranchEpoch,
    hubMode,
    isColdHub: isHubCold(),
    activeLeaderHubId: effectiveLeaderId,
    activeLeaderInfo: effectiveLeaderInfo
  };
}
var cloudUrlArgIdx = process.argv.indexOf("--cloud-url");
var cloudSyncUrl = cloudUrlArgIdx !== -1 && process.argv[cloudUrlArgIdx + 1] ? process.argv[cloudUrlArgIdx + 1] : process.env.CLOUD_SYNC_URL || process.env.VITE_GOOGLE_APPS_SCRIPT_URL || "";
var supabaseUrlArgIdx = process.argv.indexOf("--supabase-url");
var supabaseUrl = supabaseUrlArgIdx !== -1 && process.argv[supabaseUrlArgIdx + 1] ? process.argv[supabaseUrlArgIdx + 1] : process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
var supabaseKeyArgIdx = process.argv.indexOf("--supabase-key");
var supabaseKey = supabaseKeyArgIdx !== -1 && process.argv[supabaseKeyArgIdx + 1] ? process.argv[supabaseKeyArgIdx + 1] : process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
var lastCloudSyncTimestamp = 0;
var lastAppsScriptServerSeq = 0;
var cloudRoutingEpoch = 1;
var cloudBackoffUntil = 0;
var cloudSpreadsheetId = "";
var cloudJwtToken = "";
var cloudGatewayUrl = "";
var lastPolicyFetchAt = 0;
var DEFAULT_HUB_RUNTIME_POLICY = {
  protocolVersion: "4.0",
  pushBatchSize: 20,
  pullMaxPages: 12,
  requestTimeoutMs: 45e3,
  syncIntervalMs: 5 * 60 * 1e3,
  clockDriftToleranceMs: 5 * 60 * 1e3,
  blockBackdatedVoidsOnly: true,
  blockedBackdateActions: ["VOID", "REFUND"],
  blockedMasterSheetIds: ["1gtbI5TKx5qgH4g39re7hjKMlp94KZWnLhipGZ49rfPE"],
  t2EntityTypes: [],
  globalBranchEntityTypes: [],
  retentionDays: 30,
  maxStorageMb: 2048,
  genericBucketMaxItems: 5e3
};
var hubRuntimePolicy = { ...DEFAULT_HUB_RUNTIME_POLICY };
var cloudSyncIntervalHandle = null;
function applyHubRuntimePolicy(incoming) {
  if (!incoming || typeof incoming !== "object") return false;
  const prevInterval = hubRuntimePolicy.syncIntervalMs;
  const clamp = (val, min, max, fallback) => {
    const n = Number(val);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const normalizeStrList = (arr, upper, fallback) => {
    if (!Array.isArray(arr)) return fallback;
    const cleaned = arr.map((s) => String(s || "").trim()).filter(Boolean).map((s) => upper ? s.toUpperCase() : s.toLowerCase());
    return Array.from(new Set(cleaned));
  };
  hubRuntimePolicy = {
    protocolVersion: String(incoming.protocolVersion || hubRuntimePolicy.protocolVersion || "4.0"),
    pushBatchSize: clamp(incoming.pushBatchSize, 5, 50, hubRuntimePolicy.pushBatchSize),
    pullMaxPages: clamp(incoming.pullMaxPages, 2, 25, hubRuntimePolicy.pullMaxPages),
    requestTimeoutMs: clamp(incoming.requestTimeoutMs, 1e4, 9e4, hubRuntimePolicy.requestTimeoutMs),
    syncIntervalMs: clamp(incoming.syncIntervalMs, 3e4, 30 * 60 * 1e3, hubRuntimePolicy.syncIntervalMs),
    clockDriftToleranceMs: clamp(incoming.clockDriftToleranceMs, 6e4, 30 * 60 * 1e3, hubRuntimePolicy.clockDriftToleranceMs),
    blockBackdatedVoidsOnly: incoming.blockBackdatedVoidsOnly !== void 0 ? Boolean(incoming.blockBackdatedVoidsOnly) : hubRuntimePolicy.blockBackdatedVoidsOnly,
    blockedBackdateActions: Array.isArray(incoming.blockedBackdateActions) && incoming.blockedBackdateActions.length > 0 ? normalizeStrList(incoming.blockedBackdateActions, true, hubRuntimePolicy.blockedBackdateActions) : hubRuntimePolicy.blockedBackdateActions,
    blockedMasterSheetIds: Array.isArray(incoming.blockedMasterSheetIds) && incoming.blockedMasterSheetIds.length > 0 ? incoming.blockedMasterSheetIds.map((s) => String(s || "").trim()).filter(Boolean) : hubRuntimePolicy.blockedMasterSheetIds,
    t2EntityTypes: Array.isArray(incoming.t2EntityTypes) ? normalizeStrList(incoming.t2EntityTypes, false, hubRuntimePolicy.t2EntityTypes) : hubRuntimePolicy.t2EntityTypes,
    globalBranchEntityTypes: Array.isArray(incoming.globalBranchEntityTypes) ? normalizeStrList(incoming.globalBranchEntityTypes, false, hubRuntimePolicy.globalBranchEntityTypes) : hubRuntimePolicy.globalBranchEntityTypes,
    retentionDays: clamp(incoming.retentionDays, 7, 3650, hubRuntimePolicy.retentionDays),
    maxStorageMb: clamp(incoming.maxStorageMb, 64, 16384, hubRuntimePolicy.maxStorageMb),
    genericBucketMaxItems: clamp(incoming.genericBucketMaxItems, 500, 5e4, hubRuntimePolicy.genericBucketMaxItems)
  };
  if (hubRuntimePolicy.syncIntervalMs !== prevInterval && typeof restartCloudSyncTimer === "function") {
    restartCloudSyncTimer();
  }
  return true;
}
function isHubMasterTenant(companyId) {
  const u = String(companyId || "").trim().toUpperCase();
  return u === "COMP-001" || u === "COMP-MASTER" || u === "MASTER";
}
function isBlockedMasterSheetWrite(companyId, spreadsheetId) {
  if (isHubMasterTenant(companyId)) return false;
  const sid = String(spreadsheetId || "").trim();
  if (!sid) return true;
  const blockedList = Array.isArray(hubRuntimePolicy.blockedMasterSheetIds) ? hubRuntimePolicy.blockedMasterSheetIds : DEFAULT_HUB_RUNTIME_POLICY.blockedMasterSheetIds;
  return blockedList.includes(sid);
}
var CLOUD_CONFIG_FILE = path.join(process.cwd(), "hub-cloud-config.enc");
var CLOUD_CONFIG_KEY_FILE = path.join(process.cwd(), ".hub-config.key");
var cloudConfig = null;
function getCloudConfigMasterSecret() {
  if (process.env.HUB_CONFIG_SECRET && String(process.env.HUB_CONFIG_SECRET).trim()) {
    return String(process.env.HUB_CONFIG_SECRET).trim();
  }
  let fileKey = "";
  try {
    if (fs.existsSync(CLOUD_CONFIG_KEY_FILE)) {
      fileKey = fs.readFileSync(CLOUD_CONFIG_KEY_FILE, "utf8").trim();
    } else {
      fileKey = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(CLOUD_CONFIG_KEY_FILE, fileKey, { encoding: "utf8", mode: 384 });
    }
  } catch (e) {
    fileKey = "saimetric-hub-fallback-key";
  }
  return `${fileKey}|${os.hostname()}|${process.cwd()}`;
}
function encryptAndSaveCloudConfig(cfgObj) {
  try {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(getCloudConfigMasterSecret(), salt, 32);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const plaintext = JSON.stringify(cfgObj);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();
    const encryptedString = `${salt.toString("hex")}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
    fs.writeFileSync(CLOUD_CONFIG_FILE, encryptedString, { encoding: "utf8", mode: 384 });
    return true;
  } catch (err) {
    console.error("[Termux Hub] Failed to encrypt and save Cloud Config:", err.message);
    return false;
  }
}
function loadEncryptedCloudConfig() {
  try {
    if (!fs.existsSync(CLOUD_CONFIG_FILE)) {
      return null;
    }
    const raw = fs.readFileSync(CLOUD_CONFIG_FILE, "utf8").trim();
    if (!raw) return null;
    const parts = raw.split(":");
    if (parts.length !== 4) {
      throw new Error("Invalid encrypted cloud config format");
    }
    const [saltHex, ivHex, tagHex, cipherHex] = parts;
    const salt = Buffer.from(saltHex, "hex");
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(tagHex, "hex");
    const key = crypto.scryptSync(getCloudConfigMasterSecret(), salt, 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(cipherHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    const parsed = JSON.parse(decrypted);
    if (parsed && typeof parsed === "object") {
      cloudConfig = parsed;
      const creds = parsed.credentials && typeof parsed.credentials === "object" ? parsed.credentials : {};
      if (parsed.companyId && String(parsed.companyId).trim()) {
        hubTenantId = String(parsed.companyId).trim();
      }
      if (creds.token || creds.jwt) cloudJwtToken = String(creds.token || creds.jwt).trim();
      if (creds.spreadsheetId || creds.sheetId) cloudSpreadsheetId = String(creds.spreadsheetId || creds.sheetId).trim();
      if (parsed.gatewayUrl || creds.gatewayUrl) cloudGatewayUrl = String(parsed.gatewayUrl || creds.gatewayUrl).trim();
      if (parsed.runtimePolicy && typeof parsed.runtimePolicy === "object") {
        applyHubRuntimePolicy(parsed.runtimePolicy);
      }
      if (Number(creds.routingEpoch || creds.routing_epoch) > 0) {
        cloudRoutingEpoch = Math.max(cloudRoutingEpoch, Number(creds.routingEpoch || creds.routing_epoch));
      }
      console.log("[Termux Hub] \u{1F513} Loaded and decrypted Cloud Config from hub-cloud-config.enc. DB Type:", cloudConfig.databaseType || "unknown", "| Tenant:", hubTenantId, cloudGatewayUrl ? "| Gateway: enabled" : "");
      return cloudConfig;
    }
  } catch (err) {
    console.warn("[Termux Hub] Notice loading encrypted cloud config:", err.message);
  }
  return null;
}
function getHubCloudAuthFields() {
  const creds = cloudConfig && cloudConfig.credentials && typeof cloudConfig.credentials === "object" ? cloudConfig.credentials : {};
  const jwt = String(cloudJwtToken || creds.token || creds.jwt || "").trim();
  const sheetId = String(cloudSpreadsheetId || creds.spreadsheetId || creds.sheetId || "").trim();
  const epoch = Number(cloudRoutingEpoch || creds.routingEpoch || creds.routing_epoch || 1) || 1;
  return {
    ...jwt ? { jwt, token: jwt } : {},
    ...sheetId ? { spreadsheet_id: sheetId, sheet_id: sheetId, tenant_sheet_id: sheetId } : {},
    routing_epoch: epoch
  };
}
function applyHubCloudBackoff(waitMs, reason) {
  const bounded = Math.min(3e5, Math.max(1e3, Number(waitMs) || 3e3));
  cloudBackoffUntil = Math.max(cloudBackoffUntil, Date.now() + bounded);
  console.warn(`[Edge-to-Cloud] \u23F3 Cloud backoff active for ${Math.round(bounded / 1e3)}s (${reason})`);
}
function handleHubAppsScriptErrorResponse(json) {
  if (!json || typeof json !== "object") return "UNKNOWN";
  const code = String(json.code || "").toUpperCase().trim();
  if (code === "ROUTING_EPOCH_STALE") {
    const nextEp = Number(json.current_routing_epoch || json.routing_epoch || 0);
    if (nextEp > 0) cloudRoutingEpoch = nextEp;
    const nextSid = String(json.spreadsheet_id || json.sheet_id || "").trim();
    if (nextSid && nextSid.length >= 10) cloudSpreadsheetId = nextSid;
    if (cloudConfig && typeof cloudConfig === "object") {
      cloudConfig.credentials = {
        ...cloudConfig.credentials || {},
        ...cloudSpreadsheetId ? { spreadsheetId: cloudSpreadsheetId } : {},
        routingEpoch: cloudRoutingEpoch
      };
      encryptAndSaveCloudConfig(cloudConfig);
    }
    lastAppsScriptServerSeq = 0;
    lastCloudSyncTimestamp = 0;
    scheduleSave();
    const epochMsg = JSON.stringify({
      type: "HUB_ROUTING_EPOCH_UPDATED",
      action: "HUB_ROUTING_EPOCH_UPDATED",
      company_id: hubTenantId,
      routing_epoch: cloudRoutingEpoch,
      spreadsheet_id: cloudSpreadsheetId,
      timestamp: Date.now()
    });
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) {
        try {
          c.send(epochMsg);
        } catch (e) {
        }
      }
    });
    console.warn(`[Edge-to-Cloud] \u{1F504} ROUTING_EPOCH_STALE handled -> updated epoch=${cloudRoutingEpoch}, reset catch-up cursors.`);
    return "EPOCH_STALE";
  }
  if (code === "JWT_EXPIRED" || code === "JWT_INVALID" || code === "JWT_MISSING") {
    applyHubCloudBackoff(6e4, code);
    const refreshMsg = JSON.stringify({
      type: "CLOUD_AUTH_REFRESH_REQUIRED",
      action: "CLOUD_AUTH_REFRESH_REQUIRED",
      company_id: hubTenantId,
      code,
      timestamp: Date.now()
    });
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) {
        try {
          c.send(refreshMsg);
        } catch (e) {
        }
      }
    });
    return "AUTH_REQUIRED";
  }
  if (code === "RATE_LIMITED" || code === "TENANT_LOCK_BUSY" || code === "KILL_SWITCH_ACTIVE" || code === "TENANT_SUSPENDED") {
    const baseMs = Number(json.retryAfterMs) || (code === "KILL_SWITCH_ACTIVE" || code === "TENANT_SUSPENDED" ? 3e5 : code === "RATE_LIMITED" ? 15e3 : 2500);
    const jitter = code === "KILL_SWITCH_ACTIVE" || code === "TENANT_SUSPENDED" ? baseMs : baseMs + Math.floor(Math.random() * 1500);
    applyHubCloudBackoff(jitter, code);
    return "BACKOFF";
  }
  return code || "ERROR";
}
function resolveCloudAdapterConfig() {
  if (cloudConfig && typeof cloudConfig === "object") {
    if (String(cloudConfig.strategy || "").toUpperCase() === "HUB_ONLY") {
      return { databaseType: "none", credentials: {}, gatewayUrl: "", useUnifiedGateway: false };
    }
    const rawDbType = String(cloudConfig.databaseType || "").toLowerCase().trim();
    const creds = cloudConfig.credentials && typeof cloudConfig.credentials === "object" ? cloudConfig.credentials : {};
    const gwUrl = String(cloudConfig.gatewayUrl || creds.gatewayUrl || cloudGatewayUrl || "").trim();
    const normalizedDbType = rawDbType === "mongo" ? "mongodb" : rawDbType === "sheets_appscript" || rawDbType === "google_sheets" ? "appscripts" : rawDbType || (gwUrl ? "gateway" : "none");
    const useUnifiedGateway = Boolean(
      normalizedDbType === "appscripts" || normalizedDbType === "gateway" || gwUrl && (normalizedDbType === "supabase" || normalizedDbType === "firebase" || normalizedDbType === "mongodb" || normalizedDbType !== "none")
    );
    return {
      databaseType: normalizedDbType,
      credentials: creds,
      gatewayUrl: gwUrl,
      useUnifiedGateway
    };
  }
  if (cloudGatewayUrl) {
    return { databaseType: "gateway", credentials: { url: cloudSyncUrl }, gatewayUrl: cloudGatewayUrl, useUnifiedGateway: true };
  }
  if (supabaseUrl && supabaseKey) {
    return { databaseType: "supabase", credentials: { url: supabaseUrl, apiKey: supabaseKey }, gatewayUrl: "", useUnifiedGateway: false };
  }
  if (cloudSyncUrl) {
    return { databaseType: "appscripts", credentials: { url: cloudSyncUrl }, gatewayUrl: "", useUnifiedGateway: true };
  }
  return { databaseType: "none", credentials: {}, gatewayUrl: "", useUnifiedGateway: false };
}
function mapEntityTypeToTable(entityType) {
  const t = String(entityType || "").toUpperCase();
  if (t === "SALE" || t === "SALES") return "sales";
  if (t === "STAFF" || t === "SALESPERSON") return "staff";
  if (t === "CUSTOMER" || t === "CUSTOMERS") return "customers";
  if (t === "INVENTORY" || t === "INVENTORY_ITEM") return "inventory";
  if (t === "EXPENSE" || t === "EXPENSES") return "expenses";
  if (t === "CASH_LOG" || t === "CASH_LOGS") return "cash_logs";
  if (t === "GRV" || t === "DIRECT_GRV" || t === "DIRECT_GRVS") return "direct_grvs";
  if (t === "CUSTOMER_CHANGE" || t === "CUSTOMER_CHANGES") return "customer_changes";
  if (t === "CREDIT_SALE" || t === "CREDIT_SALES") return "credit_sales";
  if (t === "STOCK_MOVEMENT" || t === "STOCK_MOVEMENTS") return "stock_movements";
  return String(entityType || "records").toLowerCase();
}
function hasIncomingCloudSyncFlag(packet, ...records) {
  if (packet?.isCloudSynced === true) return true;
  if (packet?.payload?.isCloudSynced === true) return true;
  if (packet?.data?.isCloudSynced === true) return true;
  return records.some((r) => Boolean(r && r.isCloudSynced === true));
}
function parseHubTimestampMs(val) {
  if (typeof val === "number" && Number.isFinite(val) && val > 0) return val;
  if (typeof val === "string" && val.trim().length > 0) {
    const asNum = Number(val.trim());
    if (Number.isFinite(asNum) && asNum > 1e12) return asNum;
    const parsed = Date.parse(val.trim());
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}
function validatePacketClock(ws, packet, recordObj, deviceId, packetTypeLabel) {
  const originDev = String(deviceId || packet?.origin_device_id || packet?.originDeviceId || packet?.deviceId || "UNKNOWN-DEVICE").trim();
  const upperOrigin = originDev.toUpperCase();
  if (packet?.fromCloud === true || packet?.isReconPush === true || upperOrigin === "CLOUD" || upperOrigin === "SUPABASE_CLOUD" || upperOrigin === "LOCAL_HUB") {
    return { accepted: true, bypassReason: "CLOUD_OR_RECON" };
  }
  const isOfflineSync = Boolean(
    packet?.isOfflineSync === true || packet?.isOfflineCatchup === true || packet?.payload?.isOfflineSync === true || packet?.sale?.isOfflineSync === true || packet?.cashLog?.isOfflineSync === true || recordObj?.isOfflineSync === true
  );
  const hubNow = Date.now();
  const pktTs = parseHubTimestampMs(
    packet?.timestamp || packet?.updatedAt || recordObj?.refundedAt || recordObj?.voidedAt || recordObj?.timestamp || recordObj?.updatedAt
  );
  if (isOfflineSync) {
    if (pktTs > 0 && pktTs < hubNow - 3e5) {
      const minsAgo = Math.round((hubNow - pktTs) / 6e4);
      console.log(`[Termux Hub] \u23F3 Accepted delayed offline sync (${packetTypeLabel}) from [${originDev}] (created ~${minsAgo}m ago).`);
    }
    return { accepted: true, delayedOfflineSync: true };
  }
  const driftToleranceMs = Number(hubRuntimePolicy.clockDriftToleranceMs) || 3e5;
  if (pktTs > 0 && pktTs < hubNow - driftToleranceMs) {
    const blockedActions = Array.isArray(hubRuntimePolicy.blockedBackdateActions) && hubRuntimePolicy.blockedBackdateActions.length > 0 ? hubRuntimePolicy.blockedBackdateActions : DEFAULT_HUB_RUNTIME_POLICY.blockedBackdateActions;
    const upperLabel = String(packetTypeLabel || "").trim().toUpperCase();
    const isVoidOrRefundPacket = Boolean(
      blockedActions.includes(upperLabel) || blockedActions.includes("VOID") && (recordObj?.status === "Voided" || recordObj?.voidedAt) || blockedActions.includes("REFUND") && (recordObj?.status === "Refunded" || recordObj?.refundedAt)
    );
    const invId = recordObj?.id || packet?.invoice_id || packet?.id || void 0;
    const hubNowIso = new Date(hubNow).toISOString();
    if (recordObj && typeof recordObj === "object") {
      recordObj.suspicious_backdate = true;
      recordObj.clock_tamper_flagged = true;
      if (!recordObj.server_received_at) {
        recordObj.server_received_at = hubNowIso;
      }
    }
    const alertType = isVoidOrRefundPacket ? "VOID_REFUND_BLOCKED" : "HUB_FLAGGED_BACKDATE";
    const alertMsg = isVoidOrRefundPacket ? `Security Lock: Backdated ${recordObj?.status || packetTypeLabel || "Void/Refund"} blocked from ${originDev}. Please enable Automatic Date & Time.` : `Clock Flag: Backdated ${packetTypeLabel} from ${originDev} was ACCEPTED and synced to Hub (flagged for audit). Voids & refunds restricted until Automatic Date & Time is enabled.`;
    console.warn(`[Termux Hub] \u{1F6E1}\uFE0F ${isVoidOrRefundPacket ? "BLOCKED BACKDATED ACTION" : "FLAGGED & ACCEPTED"} (${packetTypeLabel}) from [${originDev}].`);
    const recentDup = securityAlertsStore.some((a) => {
      if (!a || a.deviceId !== originDev) return false;
      if (invId && a.invoiceId === invId && (a.alertType || a.type) === alertType) return true;
      if (!invId && (a.alertType || a.type) === alertType) {
        const prevMs = Date.parse(a.timestamp || a.createdAt || "");
        if (Number.isFinite(prevMs) && hubNow - prevMs < 15 * 60 * 1e3) return true;
      }
      return false;
    });
    const alertPacket = {
      id: `SEC-${hubNow}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      type: "SECURITY_ALERT",
      action: "SECURITY_ALERT",
      alertType,
      packetAccepted: !isVoidOrRefundPacket,
      reason: "CLOCK_TAMPERING",
      targetDeviceId: originDev,
      deviceId: originDev,
      deviceName: packet?.origin_device_name || packet?.originDeviceName || originDev,
      packetType: packetTypeLabel,
      packetId: packet?.packet_id || packet?.packetId || void 0,
      invoiceId: invId,
      claimedTimestamp: pktTs,
      hubTimestamp: hubNow,
      serverReceivedAt: hubNowIso,
      driftMs: pktTs - hubNow,
      origin_device_id: "LOCAL_HUB",
      origin_device_name: "Termux Local Hub",
      timestamp: hubNowIso,
      message: alertMsg
    };
    if (!recentDup) {
      securityAlertsStore.unshift(alertPacket);
      if (securityAlertsStore.length > 200) {
        securityAlertsStore = securityAlertsStore.slice(0, 200);
      }
      scheduleSave();
      const serializedAlert = JSON.stringify(alertPacket);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(serializedAlert);
        } catch (e) {
        }
      }
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          try {
            client.send(serializedAlert);
          } catch (e) {
          }
        }
      });
    }
    return { accepted: !isVoidOrRefundPacket, flagged: true, alert: alertPacket };
  }
  return { accepted: true };
}
function broadcastCloudSyncAck(wsSender, entityType, id) {
  const ackPayload = {
    type: "T1_CLOUD_SYNC_ACK",
    action: "T1_CLOUD_SYNC_ACK",
    entityType,
    id,
    isCloudSynced: true,
    origin_device_id: "LOCAL_HUB",
    origin_device_name: "Termux Local Hub",
    timestamp: Date.now()
  };
  const ackStr = JSON.stringify(ackPayload);
  if (wsSender && wsSender.readyState === WebSocket.OPEN) {
    try {
      wsSender.send(ackStr);
    } catch (e) {
    }
  }
  wss.clients.forEach((c) => {
    if (c !== wsSender && c.readyState === WebSocket.OPEN) {
      try {
        c.send(ackStr);
      } catch (e) {
      }
    }
  });
}
function annotateCloudBackdateFlag(entityType, record, serverHeaderDate) {
  if (!record || typeof record !== "object") return;
  const serverMs = serverHeaderDate ? Date.parse(serverHeaderDate) : Date.now();
  const validMs = Number.isFinite(serverMs) && serverMs > 16e11 ? serverMs : Date.now();
  const serverIso = new Date(validMs).toISOString();
  const serverDay = serverIso.slice(0, 10);
  if (!record.server_received_at) record.server_received_at = serverIso;
  let claimedDay = "";
  if (typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(record.date.trim())) {
    claimedDay = record.date.trim().slice(0, 10);
  } else if (record.timestamp) {
    const tMs = typeof record.timestamp === "number" ? record.timestamp : Date.parse(String(record.timestamp));
    if (Number.isFinite(tMs) && tMs > 0) claimedDay = new Date(tMs).toISOString().slice(0, 10);
  }
  const isSuspicious = Boolean(record.suspicious_backdate || claimedDay && claimedDay < serverDay);
  if (isSuspicious) {
    record.suspicious_backdate = true;
    const invId = record.id || record.invoice_id || "";
    const alertId = `BACKDATE-${entityType}-${invId || validMs}`;
    if (typeof securityAlertsStore !== "undefined" && Array.isArray(securityAlertsStore)) {
      const exists = securityAlertsStore.some((a) => a.id === alertId || invId && a.invoiceId === invId && a.type === "SUSPICIOUS_BACKDATE");
      if (!exists) {
        const alertObj = {
          id: alertId,
          type: "SUSPICIOUS_BACKDATE",
          deviceId: record.deviceId || record.origin_device_id || "LOCAL_HUB",
          packetType: entityType,
          invoiceId: invId,
          claimedDate: claimedDay,
          claimedTimestamp: record.timestamp,
          serverReceivedAt: record.server_received_at,
          message: `Cloud sync flagged backdated ${entityType} #${invId || "record"} (Claimed: ${claimedDay}, Server received: ${serverDay}).`,
          createdAt: serverIso
        };
        securityAlertsStore.unshift(alertObj);
        if (securityAlertsStore.length > 150) securityAlertsStore.length = 150;
        const alertPkt = JSON.stringify({
          type: "SECURITY_ALERT",
          action: "SECURITY_ALERT",
          alertType: "SUSPICIOUS_BACKDATE",
          targetDeviceId: "",
          deviceId: alertObj.deviceId,
          packetType: entityType,
          invoiceId: invId,
          claimedTimestamp: record.timestamp,
          serverReceivedAt: record.server_received_at,
          message: alertObj.message,
          origin_device_id: "LOCAL_HUB",
          timestamp: validMs
        });
        wss.clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) {
            try {
              c.send(alertPkt);
            } catch (e) {
            }
          }
        });
      }
    }
  }
}
var T2_CANONICAL_TYPES = /* @__PURE__ */ new Set([
  "inventory_item",
  "staff",
  "customer",
  "supplier",
  "branch",
  "cash_account",
  "casual_worker",
  "branch_lockdown",
  "credit_group",
  "inventory_category",
  "stocktake_session",
  "stocktake_segment",
  "stocktake_zone_assignment",
  "stocktake_zone_claim",
  "stocktake_count_submission",
  "stocktake_joint_proposal",
  "stocktake_joint_finalized",
  "stocktake_segment_unlock",
  "daily_blind_config",
  "daily_blind_count",
  "purchase_order",
  "permissions_matrix",
  "role_configs",
  "multi_currency",
  "system_settings",
  "sheets_config"
]);
var GLOBAL_BRANCH_CANONICAL_TYPES = /* @__PURE__ */ new Set([
  "inventory_item",
  "staff",
  "branch",
  "supplier",
  "inventory_category",
  "permissions_matrix",
  "role_configs",
  "multi_currency"
]);
function isCanonicalT2Type(rawType) {
  const c = String(rawType || "").trim().toLowerCase();
  if (!c) return false;
  if (T2_CANONICAL_TYPES.has(c)) return true;
  return Array.isArray(hubRuntimePolicy.t2EntityTypes) && hubRuntimePolicy.t2EntityTypes.includes(c);
}
function isHubGlobalBranchEntityType(rawType) {
  const c = String(rawType || "").trim().toLowerCase();
  if (!c) return false;
  if (GLOBAL_BRANCH_CANONICAL_TYPES.has(c)) return true;
  return Array.isArray(hubRuntimePolicy.globalBranchEntityTypes) && hubRuntimePolicy.globalBranchEntityTypes.includes(c);
}
function mapHubEntityToCanonicalType(entityType) {
  const t = String(entityType || "").trim().toUpperCase();
  if (t === "SALE" || t === "SALE_UPDATE" || t === "SALES") return "sale";
  if (t === "INVENTORY" || t === "INVENTORY_ITEM" || t === "INVENTORY_UPDATE") return "inventory_item";
  if (t === "STAFF" || t === "SALESPERSON" || t === "STAFF_MEMBER") return "staff";
  if (t === "CUSTOMER" || t === "CUSTOMERS") return "customer";
  if (t === "CUSTOMER_CHANGE" || t === "CUSTOMER_CHANGES") return "customer_change";
  if (t === "CREDIT_SALE" || t === "CREDIT_SALES") return "credit_sale";
  if (t === "CREDIT_GROUP" || t === "CREDIT_GROUPS") return "credit_group";
  if (t === "CASH_LOG" || t === "CASH_LOGS") return "cash_log";
  if (t === "CASH_LIFT" || t === "CASH_LIFTS") return "cash_lift";
  if (t === "CASH_MOVEMENT" || t === "CASH_MOVEMENTS") return "cash_movement";
  if (t === "CASH_ACCOUNT" || t === "CASH_ACCOUNTS") return "cash_account";
  if (t === "CASH_TRANSFER" || t === "CASH_TRANSFERS") return "cash_transfer";
  if (t === "GRV" || t === "DIRECT_GRV" || t === "DIRECT_GRVS") return "direct_grv";
  if (t === "GOODS_RECEIVED" || t === "GRN" || t === "GOODSRECEIVED") return "goods_received";
  if (t === "EXPENSE" || t === "EXPENSES") return "expense";
  if (t === "INTERNAL_CONSUMPTION" || t === "SHOP_USE" || t === "INTERNAL_CONSUMPTIONS") return "internal_consumption";
  if (t === "STOCK_MOVEMENT" || t === "STOCK_MOVEMENTS") return "stock_movement";
  if (t === "RECONCILIATION" || t === "RECONCILIATIONS") return "reconciliation";
  if (t === "SUPPLIER" || t === "SUPPLIERS") return "supplier";
  if (t === "ADMIN_SALE" || t === "ADMIN_SALES") return "admin_sale";
  if (t === "CASH_COUNT" || t === "CASH_COUNTS") return "cash_count";
  if (t === "VOUCHER" || t === "VOUCHERS" || t === "SUPPLIER_INVOICE" || t === "SUPPLIER_INVOICE_VOUCHER") return "supplier_invoice_voucher";
  if (t === "BUSINESS_DAY_CLOSURE" || t === "BUSINESS_DAY_CLOSURES") return "business_day_closure";
  if (t === "ELECTRONIC_SETTLEMENT" || t === "ELECTRONIC_SETTLEMENTS") return "electronic_settlement";
  if (t === "CATEGORY" || t === "CATEGORIES" || t === "INVENTORY_CATEGORY") return "inventory_category";
  if (t === "BRANCH" || t === "BRANCHES") return "branch";
  if (t === "CASUAL_WORKER" || t === "CASUAL_WORKERS") return "casual_worker";
  if (t === "BRANCH_LOCKDOWN" || t === "BRANCH_LOCKDOWNS") return "branch_lockdown";
  if (t === "STOCKTAKE_SESSION" || t === "STOCKTAKE_SESSIONS") return "stocktake_session";
  if (t === "STOCKTAKE_SEGMENT" || t === "STOCKTAKE_SEGMENTS") return "stocktake_segment";
  if (t === "STOCKTAKE_ZONE_ASSIGNMENT" || t === "STOCKTAKE_ZONE_ASSIGNMENTS") return "stocktake_zone_assignment";
  if (t === "STOCKTAKE_BLIND_COUNT" || t === "STOCKTAKE_COUNT_SUBMISSION") return "stocktake_count_submission";
  if (t === "DAILY_BLIND_CONFIG" || t === "DAILY_BLIND_CONFIGS" || t === "DAILY_BLIND_CONFIG_SYNC") return "daily_blind_config";
  if (t === "DAILY_BLIND_COUNT" || t === "DAILY_BLIND_COUNTS" || t === "DAILY_BLIND_COUNT_SYNC") return "daily_blind_count";
  if (t === "PURCHASE_ORDER" || t === "PURCHASE_ORDERS" || t === "PURCHASE_ORDER_SYNC") return "purchase_order";
  if (t === "TOMBSTONE" || t === "TOMBSTONES") return "tombstone";
  if (t === "PERMISSIONS_MATRIX") return "permissions_matrix";
  if (t === "ROLE_CONFIGS") return "role_configs";
  if (t === "MULTI_CURRENCY") return "multi_currency";
  return String(entityType || "audit_log").trim().toLowerCase();
}
function getHubCanonicalEntityId(record, canonicalType) {
  if (!record || typeof record !== "object") return "";
  if (canonicalType === "sale" || canonicalType === "admin_sale") {
    return String(record.id || record.invoice_id || record.InvoiceID || record.sale_id || "").trim();
  }
  if (canonicalType === "inventory_item") return String(record.itemId || record.ItemID || record.ProductID || record.id || "").trim();
  if (canonicalType === "staff" || canonicalType === "casual_worker") return String(record.id || record.staffId || record.pin_hash || "").trim();
  if (canonicalType === "customer") return String(record.customerId || record.CustomerID || record.id || "").trim();
  if (canonicalType === "customer_change") return String(record.id || record.changeId || record.ChangeID || "").trim();
  if (canonicalType === "credit_sale") return String(record.id || record.creditId || record.CreditID || "").trim();
  if (canonicalType === "expense") return String(record.id || record.expenseId || record.ExpenseID || "").trim();
  if (canonicalType === "goods_received") return String(record.id || record.grnId || record.GRNID || record.grn_id || "").trim();
  if (canonicalType === "reconciliation") return String(record.id || record.reconciliationId || record.date || "").trim();
  if (canonicalType === "branch" || canonicalType === "branch_lockdown") return String(record.branchId || record.branch_id || record.id || hubBranchId || "BR-MAIN").trim();
  if (canonicalType === "cash_account") return String(record.account_id || record.id || "").trim();
  if (canonicalType === "cash_transfer") return String(record.transfer_id || record.id || "").trim();
  if (canonicalType === "supplier") return String(record.supplierId || record.SupplierID || record.id || "").trim();
  if (canonicalType === "inventory_category") return String(record.categoryId || record.id || record.categoryName || "").trim();
  if (canonicalType === "credit_group") return String(record.groupId || record.id || "").trim();
  if (canonicalType === "direct_grv") return String(record.id || record.grvNumber || record.grn_id || "").trim();
  if (canonicalType === "supplier_invoice_voucher") return String(record.id || record.voucherNumber || record.voucherId || "").trim();
  if (canonicalType === "stocktake_session") return String(record.sessionId || record.id || "").trim();
  if (canonicalType === "stocktake_segment") return String(record.segmentId || record.id || "").trim();
  if (canonicalType === "stocktake_zone_assignment") return String(record.id || `${record.sessionId || ""}::${record.zoneId || ""}`).trim();
  if (canonicalType === "daily_blind_config") return String(record.id || record.configId || "").trim();
  if (canonicalType === "daily_blind_count") return String(record.id || record.countId || "").trim();
  if (canonicalType === "purchase_order") return String(record.id || record.poNumber || record.poId || "").trim();
  if (canonicalType === "permissions_matrix") return "PERMISSIONS_MATRIX";
  if (canonicalType === "role_configs") return "ROLE_CONFIGS";
  if (canonicalType === "multi_currency") return "MULTI_CURRENCY_CONFIG";
  if (canonicalType === "tombstone") return String(record.id || `${record.entityType || "entity"}::${record.entityId || ""}`).trim();
  return String(record.id || record.entityId || record.recordId || record.logId || record.cashLogId || record.changeId || record.creditId || record.movementId || record.countId || record.closureId || record.settlementId || "").trim();
}
function normalizeIncomingCloudRecord(eType, rawData, fallbackId) {
  if (!rawData || typeof rawData !== "object") return rawData;
  const d = { ...rawData };
  if (eType === "inventory_item") {
    const trueId = String(d.itemId || d.ItemID || d.ProductID || d.id || "").trim();
    const safeId = trueId && !/^USR-/i.test(trueId) ? trueId : fallbackId && !/^USR-/i.test(fallbackId) ? fallbackId : trueId || fallbackId;
    if (safeId) {
      d.itemId = safeId;
      d.id = safeId;
    }
    if (!d.itemName && (d.ItemName || d.Name || d.name || d.ProductName)) {
      d.itemName = d.ItemName || d.Name || d.name || d.ProductName;
    }
    if (!d.category && d.Category) d.category = d.Category;
    if (d.unitsPerCase === void 0 && (d.UnitsPerCase !== void 0 || d.CaseSize !== void 0)) {
      d.unitsPerCase = Math.max(1, Number(d.UnitsPerCase || d.CaseSize || 1) || 1);
    }
    if (d.costPerUnit === void 0) {
      const cu = d.costPriceUnit ?? d.CostPriceUnit ?? d.CostPerUnit ?? d.costPrice ?? d.CostPrice;
      if (cu !== void 0) d.costPerUnit = Number(cu) || 0;
    }
    if (d.costPerCase === void 0) {
      const cc = d.costPriceCase ?? d.CostPriceCase ?? d.CostPerCase;
      if (cc !== void 0) d.costPerCase = Number(cc) || 0;
      else if (d.costPerUnit !== void 0) d.costPerCase = Number(d.costPerUnit) * Math.max(1, Number(d.unitsPerCase || 1));
    }
    if (d.sellPriceUnit === void 0) {
      const su = d.SellPriceUnit ?? d.SellingPrice ?? d.price;
      if (su !== void 0) d.sellPriceUnit = Number(su) || 0;
    }
    if (d.sellPriceCase === void 0) {
      const sc = d.SellPriceCase;
      if (sc !== void 0) d.sellPriceCase = Number(sc) || 0;
    }
    if (d.totalUnits === void 0 && (d.TotalUnits !== void 0 || d.StockQuantity !== void 0)) {
      d.totalUnits = Number(d.TotalUnits ?? d.StockQuantity ?? 0) || 0;
    }
  } else if (eType === "sale") {
    const sid = String(d.id || d.invoice_id || d.InvoiceID || fallbackId || "").trim();
    if (sid) d.id = sid;
    if (d.total === void 0 && d.Total !== void 0) d.total = Number(d.Total) || 0;
    if (d.subtotal === void 0 && d.Subtotal !== void 0) d.subtotal = Number(d.Subtotal) || 0;
    if (d.discount === void 0 && d.Discount !== void 0) d.discount = Number(d.Discount) || 0;
    if (d.amountTendered === void 0 && d.AmountTendered !== void 0) d.amountTendered = Number(d.AmountTendered) || 0;
    if (d.changeGiven === void 0 && (d.ChangeGiven !== void 0 || d.ChangeDue !== void 0)) {
      d.changeGiven = Number(d.ChangeGiven ?? d.ChangeDue ?? 0) || 0;
    }
    if (!d.itemsSummary && d.ItemsSummary) d.itemsSummary = String(d.ItemsSummary);
    if (!d.paymentMethod && d.PaymentMethod) d.paymentMethod = String(d.PaymentMethod);
    if (!d.staffName && (d.StaffName || d.Cashier)) d.staffName = String(d.StaffName || d.Cashier);
    if (!d.customerName && d.CustomerName) d.customerName = String(d.CustomerName);
    if (!d.currency && d.Currency) d.currency = String(d.Currency);
    if (!d.date && d.Date) d.date = String(d.Date);
  } else if (eType === "expense") {
    if (!d.id && (d.ExpenseID || fallbackId)) d.id = String(d.ExpenseID || fallbackId);
    if (!d.description && d.Description) d.description = String(d.Description);
    if (!d.category && d.Category) d.category = String(d.Category);
    if (d.amount === void 0 && d.Amount !== void 0) d.amount = Number(d.Amount) || 0;
    if (!d.date && d.Date) d.date = String(d.Date);
  } else if (eType === "customer") {
    const cid = String(d.customerId || d.CustomerID || d.id || fallbackId || "").trim();
    if (cid) {
      d.customerId = cid;
      d.id = cid;
    }
    if (!d.name && d.Name) d.name = String(d.Name);
    if (!d.phone && d.Phone) d.phone = String(d.Phone);
  } else if (eType === "customer_change") {
    if (!d.id && (d.ChangeID || fallbackId)) d.id = String(d.ChangeID || fallbackId);
    if (!d.customerName && d.CustomerName) d.customerName = String(d.CustomerName);
    if (d.amount === void 0 && d.Amount !== void 0) d.amount = Number(d.Amount) || 0;
  } else if (eType === "credit_sale") {
    if (!d.id && (d.CreditID || fallbackId)) d.id = String(d.CreditID || fallbackId);
    if (!d.customerName && d.CustomerName) d.customerName = String(d.CustomerName);
    if (d.totalAmount === void 0 && d.TotalAmount !== void 0) d.totalAmount = Number(d.TotalAmount) || 0;
  }
  return d;
}
function buildHubSyncEnvelope(entityType, record) {
  const canonicalType = mapHubEntityToCanonicalType(entityType);
  const recId = getHubCanonicalEntityId(record, canonicalType) || `REC-${Date.now()}`;
  const cleanData = record && typeof record === "object" ? { ...record } : { id: recId };
  if ("pin" in cleanData) delete cleanData.pin;
  if ("rawPin" in cleanData) delete cleanData.rawPin;
  if ("password" in cleanData) delete cleanData.password;
  cleanData.company_id = cleanData.company_id || cleanData.companyId || hubTenantId;
  cleanData.branch_id = cleanData.branch_id || cleanData.branchId || hubBranchId;
  const updatedAtMs = parseHubTimestampMs(cleanData.updatedAt || cleanData.lastUpdated || cleanData.hubTimestamp || cleanData.timestamp) || Date.now();
  const targetBranch = cleanData.targetBranchId || cleanData.target_branch_id || (isHubGlobalBranchEntityType(canonicalType) ? "ALL" : cleanData.branch_id || hubBranchId || "ALL");
  if (canonicalType === "stocktake_session" && Array.isArray(cleanData.segments)) {
    try {
      const approxLen = JSON.stringify(cleanData).length;
      if (approxLen > 42e3) {
        cleanData.segments = cleanData.segments.map((seg) => {
          if (!seg || typeof seg !== "object") return seg;
          const compact = { ...seg };
          if (Array.isArray(compact.count1) && compact.count1.length > 0) compact.count1 = [];
          if (Array.isArray(compact.count2) && compact.count2.length > 0) compact.count2 = [];
          return compact;
        });
      }
    } catch (_) {
    }
  }
  const isT2Mutable = isCanonicalT2Type(canonicalType);
  const versionNum = Number(cleanData.version || 1);
  const resolvedPacketId = isT2Mutable ? `HUB-ENV-${canonicalType}-${recId}-v${versionNum}-${updatedAtMs}-${Math.random().toString(36).slice(2, 6)}` : String(cleanData.packetId || cleanData.clientRequestId || `HUB-ENV-${canonicalType}-${recId}-${Date.now()}`);
  return {
    packetId: resolvedPacketId,
    entityType: canonicalType,
    entityId: recId,
    action: "UPSERT",
    data: cleanData,
    updatedAt: updatedAtMs,
    version: versionNum,
    mutationSource: cleanData.mutationSource || "LOCAL_HUB",
    originDeviceId: cleanData.originDeviceId || cleanData.origin_device_id || `HUB-${hubBranchId}`,
    targetBranchId: targetBranch,
    class: isT2Mutable ? "T2" : "T1"
  };
}
async function postAppsScriptJson(targetUrl, bodyObj, timeoutMsOverride) {
  const postStr = JSON.stringify(bodyObj);
  const timeoutMs = Number(timeoutMsOverride) || Number(hubRuntimePolicy.requestTimeoutMs) || 45e3;
  const isGateway = Boolean(cloudGatewayUrl && targetUrl === cloudGatewayUrl);
  const contentType = isGateway ? "application/json" : "text/plain;charset=utf-8";
  const parseSafeJson = (rawText) => {
    const trimmed = String(rawText || "").trim();
    if (!trimmed) return { json: null, isHtml: false };
    if (trimmed.startsWith("<")) return { json: null, isHtml: true };
    try {
      return { json: JSON.parse(trimmed), isHtml: false };
    } catch (_) {
      return { json: null, isHtml: false };
    }
  };
  if (typeof fetch === "function") {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: postStr,
        ...controller ? { signal: controller.signal } : {}
      });
      const text = await res.text();
      const parsed = parseSafeJson(text);
      return {
        ok: res.ok && !parsed.isHtml,
        status: res.status,
        isHtml: parsed.isHtml,
        dateHeader: res.headers && res.headers.get ? res.headers.get("date") : null,
        json: parsed.json
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return await new Promise((resolve, reject) => {
    const isHttps = targetUrl.startsWith("https:");
    const client = isHttps ? require("https") : require("http");
    const url = new URL(targetUrl);
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + (url.search || ""),
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "Content-Length": Buffer.byteLength(postStr)
      }
    }, (res) => {
      let chunks = "";
      res.on("data", (d) => {
        chunks += d;
      });
      res.on("end", () => {
        const parsed = parseSafeJson(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300 && !parsed.isHtml,
          status: res.statusCode,
          isHtml: parsed.isHtml,
          dateHeader: res.headers ? res.headers.date : null,
          json: parsed.json
        });
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Cloud request timed out after ${Math.round(timeoutMs / 1e3)}s`));
    });
    req.on("error", reject);
    req.write(postStr);
    req.end();
  });
}
async function fetchCloudGatewayPolicy(targetUrl) {
  if (!targetUrl || Date.now() - lastPolicyFetchAt < 15 * 60 * 1e3) return;
  lastPolicyFetchAt = Date.now();
  try {
    const pingUrl = `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}action=ping`;
    if (typeof fetch === "function") {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 15e3) : null;
      try {
        const res = await fetch(pingUrl, { method: "GET", ...controller ? { signal: controller.signal } : {} });
        const text = await res.text();
        if (res.ok && text && !text.trim().startsWith("<")) {
          const json = JSON.parse(text);
          if (json && json.policy && typeof json.policy === "object") {
            applyHubRuntimePolicy(json.policy);
            scheduleSave();
            console.log(`[Edge-to-Cloud] \u{1F9ED} Synced cloud runtime policy (v${hubRuntimePolicy.protocolVersion}, batch=${hubRuntimePolicy.pushBatchSize}, pages=${hubRuntimePolicy.pullMaxPages}, timeout=${Math.round(hubRuntimePolicy.requestTimeoutMs / 1e3)}s)`);
          }
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } catch (err) {
    console.log(`[Edge-to-Cloud] Policy ping notice: ${err.message}`);
  }
}
function resolveUnifiedGatewayTarget(adapterCfg) {
  if (adapterCfg.gatewayUrl) {
    return {
      url: adapterCfg.gatewayUrl,
      isCloudGateway: true,
      extraGatewayFields: {
        backend_type: adapterCfg.databaseType,
        credentials: adapterCfg.credentials || {}
      }
    };
  }
  const url = String(
    adapterCfg.credentials.url || adapterCfg.credentials.webhookUrl || adapterCfg.credentials.masterWebhookUrl || cloudSyncUrl || ""
  ).trim();
  return { url, isCloudGateway: false, extraGatewayFields: {} };
}
function pushToCloud(entityType, record) {
  if (!record) return;
  if (record.isCloudSynced === true) {
    console.log(`[Edge Gateway] \u23ED\uFE0F Dual-Writer Skip: ${entityType} (${record.id || record.invoice_id || record.grvNumber || record.customerId || record.itemId || ""}) already cloud-synced by PWA.`);
    return;
  }
  try {
    const adapterCfg = resolveCloudAdapterConfig();
    if (adapterCfg.databaseType === "none") return;
    const canonicalType = mapHubEntityToCanonicalType(entityType);
    const isT1 = !T2_CANONICAL_TYPES.has(canonicalType) && canonicalType !== "tombstone";
    const markCloudSyncedAndAck = () => {
      record.isCloudSynced = true;
      scheduleSave();
      if (isT1) {
        const ackStr = JSON.stringify({
          type: "T1_CLOUD_SYNC_ACK",
          action: "T1_CLOUD_SYNC_ACK",
          entityType,
          id: getHubCanonicalEntityId(record, canonicalType),
          isCloudSynced: true,
          server_received_at: record.server_received_at,
          suspicious_backdate: record.suspicious_backdate,
          origin_device_id: "LOCAL_HUB",
          timestamp: Date.now()
        });
        wss.clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) {
            try {
              c.send(ackStr);
            } catch (e) {
            }
          }
        });
      }
    };
    if (adapterCfg.useUnifiedGateway) {
      if (cloudBackoffUntil > Date.now()) {
        return;
      }
      const target = resolveUnifiedGatewayTarget(adapterCfg);
      if (!target.url) return;
      const authFields = getHubCloudAuthFields();
      if (adapterCfg.databaseType === "appscripts" && isBlockedMasterSheetWrite(hubTenantId, authFields.spreadsheet_id)) {
        console.warn(`[Edge Gateway] \u{1F6E1}\uFE0F Blocked write for non-master tenant ${hubTenantId}: dedicated spreadsheet_id required (Master Sheet protected).`);
        return;
      }
      const envelope = buildHubSyncEnvelope(entityType, record);
      postAppsScriptJson(target.url, {
        action: "push_envelopes",
        company_id: hubTenantId,
        branch_id: hubBranchId,
        user_id: `HUB-${hubBranchId}`,
        user_role: "OWNER",
        user_branch_id: hubBranchId,
        ...authFields,
        ...target.extraGatewayFields,
        envelopes: [envelope],
        timestamp: Date.now()
      }).then((res) => {
        if (!res.ok) {
          console.log(`[Edge Gateway] Cloud HTTP ${res.status}${res.isHtml ? " (HTML error page)" : ""} for ${canonicalType}`);
          return;
        }
        const json = res.json;
        if (json && json.policy && typeof json.policy === "object") {
          applyHubRuntimePolicy(json.policy);
        }
        if (json && (json.success === false || json.status === "error" || typeof json.httpStatus === "number" && json.httpStatus >= 400)) {
          handleHubAppsScriptErrorResponse(json);
          return;
        }
        if (json && typeof json.current_routing_epoch === "number" && json.current_routing_epoch > cloudRoutingEpoch) {
          cloudRoutingEpoch = json.current_routing_epoch;
        }
        if (json && json.server_received_at) record.server_received_at = json.server_received_at;
        if (json && Array.isArray(json.flaggedBackdateIds) && json.flaggedBackdateIds.includes(envelope.entityId)) {
          record.suspicious_backdate = true;
        } else if (json && json.suspicious_backdate !== void 0) {
          record.suspicious_backdate = Boolean(json.suspicious_backdate);
        }
        if (canonicalType === "sale" || canonicalType === "cash_log") {
          annotateCloudBackdateFlag(entityType, record, res.dateHeader || null);
        }
        console.log(`[Edge Gateway] \u2601\uFE0F Pushed canonical envelope ${canonicalType}:${envelope.entityId} via ${target.isCloudGateway ? "Cloud Sync Gateway" : "Apps Script"}`);
        markCloudSyncedAndAck();
      }).catch((err) => {
        console.log(`[Edge Gateway] Cloud bridge notice for ${canonicalType}: ${err.message}`);
      });
      return;
    }
    if (adapterCfg.databaseType === "supabase") {
      const sbUrl = String(adapterCfg.credentials.url || adapterCfg.credentials.projectUrl || "").trim().replace(/\/+$/, "");
      const sbKey = String(adapterCfg.credentials.apiKey || adapterCfg.credentials.serviceRoleKey || adapterCfg.credentials.anonKey || "").trim();
      if (!sbUrl || !sbKey || typeof fetch !== "function") return;
      const tbl = mapEntityTypeToTable(entityType);
      const needsServerClock = entityType === "SALE" || entityType === "SALE_UPDATE" || entityType === "CASH_LOG";
      if (needsServerClock) {
        annotateCloudBackdateFlag(entityType, record, null);
      }
      const sendSupabase = (payloadRec, allowRetry) => {
        fetch(`${sbUrl}/rest/v1/${tbl}`, {
          method: "POST",
          headers: {
            apikey: sbKey,
            Authorization: `Bearer ${sbKey}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates"
          },
          body: JSON.stringify([payloadRec])
        }).then((res) => {
          if (res.ok || res.status === 201) {
            if (needsServerClock) {
              annotateCloudBackdateFlag(entityType, record, res.headers && res.headers.get ? res.headers.get("date") : null);
            }
            console.log(`[Edge Gateway] \u2601\uFE0F Pushed ${entityType} to Supabase table '${tbl}'`);
            markCloudSyncedAndAck();
          } else if (res.status === 400 && allowRetry && needsServerClock) {
            const stripped = { ...payloadRec };
            delete stripped.server_received_at;
            delete stripped.suspicious_backdate;
            sendSupabase(stripped, false);
          }
        }).catch((err) => {
          console.log(`[Edge Gateway] Supabase push notice for ${entityType}: ${err.message}`);
        });
      };
      sendSupabase(record, true);
      return;
    }
    if (adapterCfg.databaseType === "mongodb") {
      const mongoUri = String(adapterCfg.credentials.mongoUri || adapterCfg.credentials.uri || "").trim();
      const dataApiUrl = String(adapterCfg.credentials.url || "").trim().replace(/\/+$/, "");
      const dataApiKey = String(adapterCfg.credentials.apiKey || "").trim();
      if (dataApiUrl && dataApiKey && typeof fetch === "function") {
        const tbl = mapEntityTypeToTable(entityType);
        fetch(`${dataApiUrl}/action/insertOne`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": dataApiKey
          },
          body: JSON.stringify({
            collection: tbl,
            database: adapterCfg.credentials.database || "saimetric_pos",
            document: record
          })
        }).then((res) => {
          if (res.ok || res.status === 201) markCloudSyncedAndAck();
        }).catch(() => {
        });
      } else if (mongoUri) {
        try {
          const { MongoClient } = require("mongodb");
          const client = new MongoClient(mongoUri);
          client.connect().then(async () => {
            const db = client.db(adapterCfg.credentials.database || "saimetric_pos");
            const tbl = mapEntityTypeToTable(entityType);
            const idVal = record.id || record.invoice_id || record.itemId || record.customerId || `${Date.now()}`;
            await db.collection(tbl).updateOne({ id: idVal }, { $set: record }, { upsert: true });
            markCloudSyncedAndAck();
            await client.close();
          }).catch((e) => {
            console.log(`[Edge Gateway] MongoDB push notice for ${entityType}: ${e.message}`);
          });
        } catch (e) {
          console.log(`[Edge Gateway] MongoDB driver not installed locally; configured URI queued for ${entityType}`);
        }
      }
      return;
    }
    if (adapterCfg.databaseType === "firebase") {
      const projectId = String(adapterCfg.credentials.projectId || "").trim();
      const apiKey = String(adapterCfg.credentials.apiKey || "").trim();
      if (!projectId || typeof fetch !== "function") return;
      const tbl = mapEntityTypeToTable(entityType);
      const docId = encodeURIComponent(String(record.id || record.invoice_id || record.itemId || record.customerId || Date.now()));
      const qs = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
      fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${tbl}/${docId}${qs}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { payloadJson: { stringValue: JSON.stringify(record) } } })
      }).then((res) => {
        if (res.ok) markCloudSyncedAndAck();
      }).catch(() => {
      });
      return;
    }
  } catch (err) {
    console.log(`[Edge Gateway] Cloud push notice: ${err.message}`);
  }
}
function broadcastInventorySnapshot(item) {
  if (!item) return;
  const snapTime = Date.now();
  item.snapshotTimestamp = snapTime;
  item.updatedAt = snapTime;
  item.hubTimestamp = snapTime;
  item.lastUpdated = new Date(snapTime).toISOString();
  scheduleSave();
  const pktStr = JSON.stringify({
    type: "INVENTORY_UPDATE",
    action: "INVENTORY_UPDATE",
    entityType: "INVENTORY",
    itemId: item.itemId || item.id,
    item: {
      ...item,
      totalUnits: Number(item.totalUnits || 0),
      stockSingles: Number(item.stockSingles !== void 0 ? item.stockSingles : item.totalUnits || 0),
      snapshotTimestamp: snapTime
    },
    payload: {
      ...item,
      totalUnits: Number(item.totalUnits || 0),
      stockSingles: Number(item.stockSingles !== void 0 ? item.stockSingles : item.totalUnits || 0),
      snapshotTimestamp: snapTime
    },
    snapshotTimestamp: snapTime,
    totalUnits: Number(item.totalUnits || 0),
    stockSingles: Number(item.stockSingles !== void 0 ? item.stockSingles : item.totalUnits || 0),
    origin_device_id: "LOCAL_HUB",
    origin_device_name: "Termux Local Hub",
    timestamp: snapTime
  });
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      try {
        c.send(pktStr);
      } catch (e) {
      }
    }
  });
}
var DATA_FILE = path.join(process.cwd(), "termux-hub-data.json");
var BLIND_VAULT_FILE = path.join(process.cwd(), "hub-blind-vault.json");
var MAX_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;
var ROTATION_DAYS = 30;
var salesStore = [];
var inventoryStore = [];
var directGrvsStore = [];
var cashMovementsStore = [];
var cashLiftsStore = [];
var cashLogsStore = [];
var customerChangesStore = [];
var creditSalesStore = [];
var creditGroupsStore = [];
var stockMovementsStore = [];
var expensesStore = [];
var cashTransfersStore = [];
var internalConsumptionsStore = [];
var suppliersStore = [];
var adminSalesStore = [];
var cashCountsStore = [];
var vouchersStore = [];
var categoriesStore = [];
var casualWorkersStore = [];
var zoneAssignmentsStore = [];
var branchLockdownsStore = {};
var stocktakeSessionsStore = [];
var stocktakeSegmentsStore = [];
var dailyBlindConfigsStore = [];
var dailyBlindCountsStore = [];
var purchaseOrdersStore = [];
var salespeopleStore = [];
var customersStore = [];
var branchesStore = [];
var cashAccountsStore = [];
var permissionsMatrixStore = { rules: [], updatedAt: 0 };
var roleConfigsStore = { definitions: null, updatedAt: 0 };
var multiCurrencyStore = { config: null, updatedAt: 0 };
var tombstonesStore = [];
var securityAlertsStore = [];
var businessDayClosuresStore = [];
var electronicSettlementsStore = [];
var genericEntitiesStore = {};
function upsertGenericEntityInHub(entityType, entityId, dataObj, meta = {}) {
  const eType = String(entityType || "").trim().toLowerCase();
  const eId = String(entityId || "").trim();
  if (!eType || !eId || !dataObj || typeof dataObj !== "object") return false;
  if (!genericEntitiesStore[eType] || typeof genericEntitiesStore[eType] !== "object") {
    genericEntitiesStore[eType] = {};
  }
  const bucket = genericEntitiesStore[eType];
  const existing = bucket[eId];
  const incomingTs = parseHubTimestampMs(meta.updatedAt || dataObj.updatedAt || dataObj.lastUpdated || dataObj.timestamp) || Date.now();
  const entityClass = meta.class || (isCanonicalT2Type(eType) ? "T2" : "T1");
  if (existing) {
    const existingTs = parseHubTimestampMs(existing._updatedAt || existing.updatedAt || existing.lastUpdated) || 0;
    if (entityClass === "T2" && existingTs > 0 && existingTs > incomingTs + 6e4) {
      return false;
    }
  }
  const merged = {
    ...existing || {},
    ...dataObj,
    id: dataObj.id || eId,
    company_id: dataObj.company_id || dataObj.companyId || hubTenantId,
    branch_id: dataObj.branch_id || dataObj.branchId || hubBranchId,
    _entityType: eType,
    _entityId: eId,
    _class: entityClass,
    _updatedAt: incomingTs,
    updatedAt: incomingTs,
    ...meta.isCloudSynced === true ? { isCloudSynced: true } : { isCloudSynced: existing?.isCloudSynced === true && meta.isCloudSynced !== false }
  };
  bucket[eId] = merged;
  const bucketMaxItems = Math.max(500, Number(hubRuntimePolicy.genericBucketMaxItems) || 5e3);
  const keys = Object.keys(bucket);
  if (keys.length > bucketMaxItems) {
    keys.sort((a, b) => (bucket[a]?._updatedAt || 0) - (bucket[b]?._updatedAt || 0)).slice(0, keys.length - bucketMaxItems).forEach((k) => delete bucket[k]);
  }
  return true;
}
var hubBlindStore = {};
function loadBlindVault() {
  try {
    if (fs.existsSync(BLIND_VAULT_FILE)) {
      const raw = fs.readFileSync(BLIND_VAULT_FILE, "utf8");
      hubBlindStore = JSON.parse(raw) || {};
      const sessionCount = Object.keys(hubBlindStore).length;
      console.log(`[Hub] Loaded ${sessionCount} sessions from blind vault.`);
    } else {
      hubBlindStore = {};
    }
  } catch (e) {
    console.warn("[Hub] Notice loading blind vault file:", e.message);
    hubBlindStore = {};
  }
}
function saveBlindVault() {
  try {
    fs.writeFileSync(BLIND_VAULT_FILE, JSON.stringify(hubBlindStore, null, 2), "utf8");
  } catch (e) {
    console.error("[Hub] Error saving blind vault:", e.message);
  }
}
function isValidBranchRecord(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (rec.creditLimit !== void 0 || rec.outstandingDebt !== void 0 || rec.customerId !== void 0 || rec.currentBalance !== void 0 || rec.maxCreditReceiptCount !== void 0 || rec.isCustomLimit !== void 0 || rec.creditGroupId !== void 0 || rec.creditGroupName !== void 0 || rec.debt !== void 0) {
    return false;
  }
  if (rec.pin_hash !== void 0 || rec.pin_salt !== void 0 || rec.pin !== void 0 || rec.role !== void 0 || rec.permissions !== void 0 || rec.branchAssignments !== void 0) {
    return false;
  }
  if (rec.supplierId !== void 0 || rec.SupplierID !== void 0 || rec.contactPerson !== void 0 || rec.paymentTerms !== void 0 || rec.taxNumber !== void 0 || rec.accountNumber !== void 0 || rec.bankAccount !== void 0 || rec.bankName !== void 0 || rec.category !== void 0 && typeof rec.category === "string" && !rec.code && !rec.location) {
    return false;
  }
  if (rec.itemId !== void 0 || rec.costPrice !== void 0 || rec.costPerUnit !== void 0 || rec.sellPriceUnit !== void 0 || rec.totalUnits !== void 0 || rec.stockSingles !== void 0 || rec.stockCases !== void 0 || rec.unitsPerCase !== void 0 || rec.barcode !== void 0 || rec.sku !== void 0) {
    return false;
  }
  const bId = rec.branchId || rec.id || rec.branch_id || rec.BranchID;
  return Boolean(bId);
}
function canonicalizeHubBranchId(rawId) {
  const clean = String(rawId || "").trim();
  if (!clean) return "BR-MAIN";
  const low = clean.toLowerCase();
  return low === "1" || low === "br-main" || low === "br001" ? "BR-MAIN" : clean;
}
function normHubBranchTenant(val) {
  const u = String(val || "COMP-001").trim().toUpperCase();
  return !u || u === "DEFAULT" || u === "COMP-001" || u === "COMP-MASTER" ? "COMP-001" : u;
}
function isHubPlaceholderBranchName(name) {
  const clean = String(name || "").trim().toLowerCase();
  return !clean || clean === "branch" || clean === "main branch" || clean === "unnamed branch";
}
function isHubPlaceholderBranchCode(code, id) {
  const clean = String(code || "").trim().toLowerCase();
  const cleanId = String(id || "").trim().toLowerCase();
  return !clean || cleanId.length > 0 && clean === cleanId || clean === "branch";
}
function normalizeAndDeduplicateHubBranches(list) {
  if (!Array.isArray(list)) return [];
  const byKey = /* @__PURE__ */ new Map();
  const codeToKey = /* @__PURE__ */ new Map();
  for (const b of list) {
    if (!isValidBranchRecord(b)) {
      console.warn(`[Termux Hub] \u{1F9F9} Purged contaminated non-branch record from Hub memory/disk: ${b?.name || b?.branchName || b?.branchId || b?.id}`);
      continue;
    }
    const rawId = b.branchId || b.id || b.branch_id || b.BranchID;
    const canonId = canonicalizeHubBranchId(rawId);
    const comp = normHubBranchTenant(b.company_id || b.companyId || b.CompanyID || hubTenantId);
    const name = String(b.name || b.branch_name || b.branchName || b.Name || "").trim();
    const code = String(b.code || b.branch_code || b.branchCode || b.Code || "").trim();
    const loc = String(b.location || b.address || b.Location || b.Address || "").trim();
    const normRec = {
      ...b,
      branchId: canonId,
      id: canonId,
      branch_id: canonId,
      company_id: comp,
      companyId: comp,
      ...name ? { name } : {},
      ...code ? { code } : {},
      ...loc ? { location: loc, address: loc } : {}
    };
    const idKey = `${comp}::${canonId.toUpperCase()}`;
    const codeKey = !isHubPlaceholderBranchCode(code, canonId) ? `${comp}::CODE::${code.toUpperCase()}` : "";
    const dupKey = byKey.has(idKey) ? idKey : codeKey ? codeToKey.get(codeKey) : void 0;
    if (dupKey && byKey.has(dupKey)) {
      const prev = byKey.get(dupKey);
      const prevTs = getTimestamp(prev);
      const currTs = getTimestamp(normRec);
      const preferCurr = canonId === "BR-MAIN" && prev.branchId !== "BR-MAIN" || canonId === prev.branchId && currTs > prevTs || isHubPlaceholderBranchName(prev.name) && !isHubPlaceholderBranchName(normRec.name);
      const winner = preferCurr ? normRec : prev;
      const loser = preferCurr ? prev : normRec;
      byKey.set(dupKey, {
        ...loser,
        ...winner,
        name: !isHubPlaceholderBranchName(winner.name) ? winner.name : loser.name || winner.name,
        code: !isHubPlaceholderBranchCode(winner.code, winner.branchId) ? winner.code : loser.code || winner.code,
        location: winner.location || loser.location || "",
        address: winner.address || winner.location || loser.address || loser.location || ""
      });
      continue;
    }
    byKey.set(idKey, normRec);
    if (codeKey) codeToKey.set(codeKey, idKey);
  }
  return Array.from(byKey.values());
}
function isValidStaffRecord(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (rec.customerId !== void 0 || rec.creditLimit !== void 0 || rec.supplierId !== void 0) {
    return false;
  }
  return Boolean(rec.id || rec.staffId || rec.pin_hash || rec.role);
}
function isValidCustomerRecord(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (rec.pin_hash !== void 0 || rec.pin_salt !== void 0 || rec.role !== void 0 || rec.supplierId !== void 0) {
    return false;
  }
  return Boolean(rec.customerId || rec.id || rec.name || rec.creditLimit !== void 0);
}
function isMatch(rec, reqComp, reqBranch, isCatalog = false) {
  if (!rec) return false;
  const normComp = (val) => {
    const u = String(val || "COMP-001").trim().toUpperCase();
    return !u || u === "DEFAULT" || u === "COMP-001" || u === "COMP-MASTER" ? "COMP-001" : u;
  };
  const c = normComp(rec.company_id || rec.companyId);
  const rc = reqComp ? normComp(reqComp) : "";
  if (rc && c && c !== rc) return false;
  if (isCatalog) {
    if (rec.assignedBranchIds && Array.isArray(rec.assignedBranchIds) && rec.assignedBranchIds.length > 0) {
      if (reqBranch && reqBranch !== "ALL" && !rec.assignedBranchIds.map((b2) => String(b2).toUpperCase()).includes(reqBranch)) {
        return false;
      }
    }
    return true;
  }
  const b = (rec.branch_id || rec.branchId || "").trim().toUpperCase();
  if (reqBranch && b && reqBranch !== "ALL" && b !== "ALL" && b !== reqBranch) return false;
  return true;
}
function getTimestamp(rec) {
  if (!rec) return 0;
  const parseTs = (v) => {
    if (v === void 0 || v === null || v === "") return 0;
    if (typeof v === "number") return isNaN(v) ? 0 : v;
    const tm = new Date(v).getTime();
    return isNaN(tm) ? 0 : tm;
  };
  const candidates = [
    rec.updatedAt,
    rec.hubTimestamp,
    rec.lastUpdated,
    rec.updated_at,
    rec.refundedAt,
    rec.voidedAt,
    rec.mobileVerifiedAt
  ];
  let best = 0;
  for (let i = 0; i < candidates.length; i++) {
    const val = parseTs(candidates[i]);
    if (val > best) best = val;
  }
  if (best > 0) return best;
  const fallback = rec.timestamp ?? rec.createdAt ?? rec.created_at ?? rec.date;
  return parseTs(fallback);
}
function pruneOldRecords() {
  const effectiveRetentionDays = Math.max(7, Number(hubRuntimePolicy.retentionDays) || ROTATION_DAYS);
  const cutoffTime = Date.now() - effectiveRetentionDays * 24 * 60 * 60 * 1e3;
  const shouldRetain = (rec) => {
    const isOld = getTimestamp(rec) < cutoffTime && Boolean(rec.date);
    if (!isOld) return true;
    return rec.isCloudSynced !== true;
  };
  salesStore = salesStore.filter(shouldRetain);
  directGrvsStore = directGrvsStore.filter(shouldRetain);
  cashMovementsStore = cashMovementsStore.filter(shouldRetain);
  cashLogsStore = cashLogsStore.filter(shouldRetain);
  cashLiftsStore = cashLiftsStore.filter(shouldRetain);
  customerChangesStore = customerChangesStore.filter(shouldRetain);
  creditSalesStore = creditSalesStore.filter(shouldRetain);
  creditGroupsStore = creditGroupsStore.filter(shouldRetain);
  stockMovementsStore = stockMovementsStore.filter(shouldRetain);
  expensesStore = expensesStore.filter(shouldRetain);
  cashTransfersStore = cashTransfersStore.filter(shouldRetain);
  internalConsumptionsStore = internalConsumptionsStore.filter(shouldRetain);
  suppliersStore = suppliersStore.filter(shouldRetain);
  adminSalesStore = adminSalesStore.filter(shouldRetain);
  cashCountsStore = cashCountsStore.filter(shouldRetain);
  vouchersStore = vouchersStore.filter(shouldRetain);
  businessDayClosuresStore = businessDayClosuresStore.filter(shouldRetain);
  electronicSettlementsStore = electronicSettlementsStore.filter(shouldRetain);
  if (genericEntitiesStore && typeof genericEntitiesStore === "object") {
    for (const [gType, bucket] of Object.entries(genericEntitiesStore)) {
      if (!bucket || typeof bucket !== "object") continue;
      if (isCanonicalT2Type(gType)) continue;
      for (const [gId, rec] of Object.entries(bucket)) {
        if (!rec || typeof rec !== "object") continue;
        if (rec._class === "T2") continue;
        if (rec.isCloudSynced !== true) continue;
        const recTs = Number(rec._updatedAt || getTimestamp(rec)) || 0;
        if (recTs > 0 && recTs < cutoffTime) {
          delete bucket[gId];
        }
      }
    }
  }
}
var DATA_TMP_FILE = `${DATA_FILE}.tmp`;
var DATA_BACKUP_FILE = `${DATA_FILE}.bak`;
function readParsedDataFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw || !raw.trim()) return null;
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" ? parsed : null;
}
function loadData() {
  try {
    let parsed = null;
    try {
      parsed = readParsedDataFile(DATA_FILE);
    } catch (primaryErr) {
      console.warn("[Termux Hub] Primary data file unreadable, attempting .bak recovery:", primaryErr.message);
      try {
        parsed = readParsedDataFile(DATA_BACKUP_FILE);
        if (parsed) {
          fs.copyFileSync(DATA_BACKUP_FILE, DATA_FILE);
          console.log("[Termux Hub] \u2705 Recovered branch state cleanly from backup snapshot.");
        }
      } catch (bakErr) {
        console.warn("[Termux Hub] Backup recovery failed:", bakErr.message);
      }
    }
    if (!parsed && fs.existsSync(DATA_BACKUP_FILE)) {
      try {
        parsed = readParsedDataFile(DATA_BACKUP_FILE);
      } catch {
      }
    }
    if (parsed) {
      if (parsed.hubBranchId) hubBranchId = parsed.hubBranchId;
      if (parsed.hubBranchName) hubBranchName = parsed.hubBranchName;
      if (parsed.hubTenantId) hubTenantId = parsed.hubTenantId;
      if (parsed.lastCloudSyncTimestamp) lastCloudSyncTimestamp = Number(parsed.lastCloudSyncTimestamp) || 0;
      if (parsed.lastAppsScriptServerSeq) lastAppsScriptServerSeq = Number(parsed.lastAppsScriptServerSeq) || 0;
      if (parsed.cloudRoutingEpoch) cloudRoutingEpoch = Math.max(1, Number(parsed.cloudRoutingEpoch) || 1);
      if (parsed.cloudSpreadsheetId) cloudSpreadsheetId = String(parsed.cloudSpreadsheetId || "").trim();
      if (parsed.cloudGatewayUrl) cloudGatewayUrl = String(parsed.cloudGatewayUrl || "").trim();
      if (parsed.hubRuntimePolicy && typeof parsed.hubRuntimePolicy === "object") {
        applyHubRuntimePolicy(parsed.hubRuntimePolicy);
      }
      if (parsed.genericEntities && typeof parsed.genericEntities === "object") {
        genericEntitiesStore = parsed.genericEntities;
      }
      if (Array.isArray(parsed.sales)) salesStore = parsed.sales;
      if (Array.isArray(parsed.inventory)) inventoryStore = parsed.inventory;
      if (Array.isArray(parsed.directGrvs)) directGrvsStore = parsed.directGrvs;
      if (Array.isArray(parsed.cashMovements)) cashMovementsStore = parsed.cashMovements;
      if (Array.isArray(parsed.cashLifts)) cashLiftsStore = parsed.cashLifts;
      if (Array.isArray(parsed.cashLogs)) cashLogsStore = deduplicateHubCashLogs(parsed.cashLogs);
      if (Array.isArray(parsed.customerChanges)) customerChangesStore = parsed.customerChanges;
      if (Array.isArray(parsed.creditSales)) creditSalesStore = parsed.creditSales;
      if (Array.isArray(parsed.creditGroups)) creditGroupsStore = parsed.creditGroups;
      if (Array.isArray(parsed.stockMovements)) stockMovementsStore = deduplicateHubStockMovements(parsed.stockMovements);
      if (Array.isArray(parsed.expenses)) expensesStore = parsed.expenses;
      if (Array.isArray(parsed.cashTransfers)) cashTransfersStore = parsed.cashTransfers;
      if (Array.isArray(parsed.internalConsumptions)) internalConsumptionsStore = parsed.internalConsumptions;
      if (Array.isArray(parsed.suppliers)) suppliersStore = parsed.suppliers;
      if (Array.isArray(parsed.adminSales)) adminSalesStore = parsed.adminSales;
      if (Array.isArray(parsed.cashCounts)) cashCountsStore = parsed.cashCounts;
      if (Array.isArray(parsed.vouchers)) vouchersStore = parsed.vouchers;
      if (Array.isArray(parsed.categories)) categoriesStore = parsed.categories;
      if (Array.isArray(parsed.casualWorkers)) {
        casualWorkersStore = parsed.casualWorkers.map((cw) => {
          if (cw && cw.pin) delete cw.pin;
          return cw;
        });
      }
      if (Array.isArray(parsed.zoneAssignments)) zoneAssignmentsStore = parsed.zoneAssignments;
      if (Array.isArray(parsed.salespeople)) {
        salespeopleStore = parsed.salespeople.map((sp) => {
          if (sp && sp.pin) delete sp.pin;
          return sp;
        });
      }
      if (Array.isArray(parsed.customers)) customersStore = parsed.customers.filter(isValidCustomerRecord);
      if (Array.isArray(parsed.branches)) {
        branchesStore = normalizeAndDeduplicateHubBranches(parsed.branches);
      }
      if (Array.isArray(parsed.cashAccounts)) cashAccountsStore = parsed.cashAccounts;
      if (Array.isArray(parsed.businessDayClosures)) businessDayClosuresStore = parsed.businessDayClosures;
      if (Array.isArray(parsed.electronicSettlements)) electronicSettlementsStore = parsed.electronicSettlements;
      if (parsed.branchLockdowns && typeof parsed.branchLockdowns === "object") {
        branchLockdownsStore = parsed.branchLockdowns;
      }
      if (Array.isArray(parsed.stocktakeSessions)) stocktakeSessionsStore = parsed.stocktakeSessions;
      if (Array.isArray(parsed.stocktakeSegments)) stocktakeSegmentsStore = parsed.stocktakeSegments;
      if (Array.isArray(parsed.dailyBlindConfigs)) dailyBlindConfigsStore = parsed.dailyBlindConfigs;
      if (Array.isArray(parsed.dailyBlindCounts)) dailyBlindCountsStore = parsed.dailyBlindCounts;
      if (Array.isArray(parsed.purchaseOrders)) purchaseOrdersStore = parsed.purchaseOrders;
      if (Array.isArray(parsed.tombstones)) tombstonesStore = parsed.tombstones;
      if (Array.isArray(parsed.securityAlerts)) securityAlertsStore = parsed.securityAlerts;
      if (parsed.permissionsMatrix && Array.isArray(parsed.permissionsMatrix.rules)) {
        permissionsMatrixStore = {
          rules: parsed.permissionsMatrix.rules,
          updatedAt: Number(parsed.permissionsMatrix.updatedAt) || 0,
          ...parsed.permissionsMatrix.isCloudSynced === true ? { isCloudSynced: true } : {}
        };
      }
      if (parsed.roleConfigs && parsed.roleConfigs.definitions && typeof parsed.roleConfigs.definitions === "object") {
        roleConfigsStore = {
          definitions: parsed.roleConfigs.definitions,
          updatedAt: Number(parsed.roleConfigs.updatedAt) || 0,
          ...parsed.roleConfigs.isCloudSynced === true ? { isCloudSynced: true } : {}
        };
      }
      if (parsed.multiCurrency && parsed.multiCurrency.config && typeof parsed.multiCurrency.config === "object") {
        multiCurrencyStore = {
          config: parsed.multiCurrency.config,
          updatedAt: Number(parsed.multiCurrency.updatedAt) || 0
        };
      }
      if (tombstonesStore.length > 0) {
        for (const t of tombstonesStore) {
          if (t && t.entityId) {
            purgeEntityFromHubStores(t.entityType, t.entityId, Number(t.deletedAt) || getTimestamp(t) || Date.now());
          }
        }
      }
      console.log(
        `[Termux Hub] Loaded from disk: [Branch: ${hubBranchId} - ${hubBranchName}], ${salesStore.length} sales, ${directGrvsStore.length} direct GRVs, ${inventoryStore.length} items, ${salespeopleStore.length} staff, ${customersStore.length} customers, ${branchesStore.length} branches, ${cashAccountsStore.length} cash accounts, ${suppliersStore.length} suppliers, ${adminSalesStore.length} admin sales, ${cashCountsStore.length} cash counts, ${vouchersStore.length} vouchers, ${businessDayClosuresStore.length} closures, ${electronicSettlementsStore.length} settlements, ${categoriesStore.length} categories, ${tombstonesStore.length} tombstones.`
      );
    }
  } catch (e) {
    console.warn("[Termux Hub] Notice loading data file:", e.message);
  }
  loadEncryptedCloudConfig();
}
var saveTimeout = null;
var saveInFlight = false;
var saveDirty = false;
var isShuttingDown = false;
function scheduleSave() {
  saveDirty = true;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    void saveData();
  }, 200);
}
function buildSerializedDataPayload() {
  pruneOldRecords();
  const payload = {
    hubBranchId,
    hubBranchName,
    hubTenantId,
    lastCloudSyncTimestamp,
    lastAppsScriptServerSeq,
    cloudRoutingEpoch,
    cloudSpreadsheetId,
    cloudGatewayUrl,
    hubRuntimePolicy,
    sales: salesStore,
    inventory: inventoryStore,
    directGrvs: directGrvsStore,
    cashMovements: cashMovementsStore,
    cashLifts: cashLiftsStore,
    cashLogs: cashLogsStore,
    customerChanges: customerChangesStore,
    creditSales: creditSalesStore,
    creditGroups: creditGroupsStore,
    stockMovements: stockMovementsStore,
    expenses: expensesStore,
    cashTransfers: cashTransfersStore,
    internalConsumptions: internalConsumptionsStore,
    suppliers: suppliersStore,
    adminSales: adminSalesStore,
    cashCounts: cashCountsStore,
    vouchers: vouchersStore,
    categories: categoriesStore,
    casualWorkers: casualWorkersStore,
    zoneAssignments: zoneAssignmentsStore,
    salespeople: salespeopleStore,
    customers: customersStore,
    branches: branchesStore,
    cashAccounts: cashAccountsStore,
    businessDayClosures: businessDayClosuresStore,
    electronicSettlements: electronicSettlementsStore,
    branchLockdowns: branchLockdownsStore,
    stocktakeSessions: stocktakeSessionsStore,
    dailyBlindConfigs: dailyBlindConfigsStore,
    dailyBlindCounts: dailyBlindCountsStore,
    purchaseOrders: purchaseOrdersStore,
    stocktakeSegments: stocktakeSegmentsStore,
    tombstones: tombstonesStore,
    securityAlerts: securityAlertsStore,
    permissionsMatrix: permissionsMatrixStore,
    roleConfigs: roleConfigsStore,
    multiCurrency: multiCurrencyStore,
    genericEntities: genericEntitiesStore,
    savedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const serialized = JSON.stringify(payload);
  const byteSize = Buffer.byteLength(serialized, "utf8");
  const effectiveMaxStorageMb = Math.max(64, Number(hubRuntimePolicy.maxStorageMb) || 2048);
  const effectiveMaxBytes = effectiveMaxStorageMb * 1024 * 1024;
  if (byteSize > effectiveMaxBytes) {
    const hasUnsyncedGeneric = Object.values(genericEntitiesStore || {}).some(
      (bucket) => bucket && typeof bucket === "object" ? Object.values(bucket).some((r) => r && r.isCloudSynced !== true) : false
    );
    const hasUnsynced = salesStore.some((s) => s.isCloudSynced !== true) || directGrvsStore.some((g) => g.isCloudSynced !== true) || expensesStore.some((e) => e.isCloudSynced !== true) || hasUnsyncedGeneric;
    if (hasUnsynced) {
      console.error(`[Termux Hub] \u274C CRITICAL: Hub storage (${(byteSize / (1024 * 1024)).toFixed(1)} MB) exceeds ${effectiveMaxStorageMb} MB policy limit, but unsynced transactions are present. Cannot prune unsynced records!`);
      throw new Error(`Termux Hub storage capacity reached (${effectiveMaxStorageMb} MB) with un-synced cloud transactions. Please restore cloud connectivity.`);
    } else {
      console.warn(`[Termux Hub] Warning: Hub data exceeds ${effectiveMaxStorageMb} MB limit. Trimming already-synced oldest records...`);
      salesStore = salesStore.filter((s) => s.isCloudSynced !== true).concat(salesStore.filter((s) => s.isCloudSynced === true).slice(0, 2500));
      directGrvsStore = directGrvsStore.filter((g) => g.isCloudSynced !== true).concat(directGrvsStore.filter((g) => g.isCloudSynced === true).slice(0, 500));
      payload.sales = salesStore;
      payload.directGrvs = directGrvsStore;
      return JSON.stringify(payload);
    }
  }
  return serialized;
}
function saveDataSyncAtomic() {
  try {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    const serialized = buildSerializedDataPayload();
    const fd = fs.openSync(DATA_TMP_FILE, "w", 384);
    try {
      fs.writeSync(fd, serialized, 0, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(DATA_FILE)) {
      try {
        fs.copyFileSync(DATA_FILE, DATA_BACKUP_FILE);
      } catch {
      }
    }
    fs.renameSync(DATA_TMP_FILE, DATA_FILE);
    saveDirty = false;
  } catch (e) {
    console.error("[Termux Hub] Error in atomic sync save:", e.message);
  }
}
async function saveData() {
  if (isShuttingDown) {
    saveDataSyncAtomic();
    return;
  }
  if (saveInFlight) {
    saveDirty = true;
    return;
  }
  saveInFlight = true;
  try {
    do {
      saveDirty = false;
      const serialized = buildSerializedDataPayload();
      const handle = await fs.promises.open(DATA_TMP_FILE, "w", 384);
      try {
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (fs.existsSync(DATA_FILE)) {
        try {
          await fs.promises.copyFile(DATA_FILE, DATA_BACKUP_FILE);
        } catch {
        }
      }
      await fs.promises.rename(DATA_TMP_FILE, DATA_FILE);
    } while (saveDirty && !isShuttingDown);
  } catch (e) {
    console.error("[Termux Hub] Error saving data file:", e.message);
  } finally {
    saveInFlight = false;
  }
}
loadData();
loadBlindVault();
var SECURITY_FILE = path.join(process.cwd(), "hub-security.json");
var SECURITY_TMP_FILE = `${SECURITY_FILE}.tmp`;
var SECURITY_BACKUP_FILE = `${SECURITY_FILE}.bak`;
var hubSecurityState = {
  hubId: `HUB-${hubBranchId}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
  pairedDevices: {},
  activePairCode: null,
  pairCodeExpiresAt: 0
};
var pendingPairRequests = /* @__PURE__ */ new Map();
var pairRateLimitMap = /* @__PURE__ */ new Map();
function loadHubSecurityState() {
  try {
    let parsed = null;
    try {
      parsed = readParsedDataFile(SECURITY_FILE);
    } catch (primaryErr) {
      console.warn("[Termux Hub] hub-security.json unreadable, trying backup:", primaryErr.message);
      parsed = readParsedDataFile(SECURITY_BACKUP_FILE);
    }
    if (parsed && typeof parsed === "object") {
      hubSecurityState = {
        hubId: String(parsed.hubId || hubSecurityState.hubId),
        pairedDevices: parsed.pairedDevices && typeof parsed.pairedDevices === "object" ? parsed.pairedDevices : {},
        activePairCode: parsed.activePairCode || null,
        pairCodeExpiresAt: Number(parsed.pairCodeExpiresAt || 0)
      };
    } else if (!fs.existsSync(SECURITY_FILE)) {
      saveHubSecurityState();
    }
  } catch (err) {
    console.warn("[Termux Hub] Failed to load hub-security.json:", err.message);
  }
}
function saveHubSecurityState() {
  try {
    const serialized = JSON.stringify(hubSecurityState, null, 2);
    const fd = fs.openSync(SECURITY_TMP_FILE, "w", 384);
    try {
      fs.writeSync(fd, serialized, 0, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(SECURITY_FILE)) {
      try {
        fs.copyFileSync(SECURITY_FILE, SECURITY_BACKUP_FILE);
      } catch {
      }
    }
    fs.renameSync(SECURITY_TMP_FILE, SECURITY_FILE);
  } catch (err) {
    console.warn("[Termux Hub] Failed to save hub-security.json:", err.message);
  }
}
function hubHmacSha256Hex(secret, message) {
  return crypto.createHmac("sha256", String(secret)).update(String(message), "utf8").digest("hex");
}
function hubConstantTimeEqual(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  if (!sa || !sb || sa.length !== sb.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sa, "utf8"), Buffer.from(sb, "utf8"));
  } catch {
    return false;
  }
}
function computeHubVisualConfirmCode(hubId, deviceId, clientNonce) {
  const hashHex = crypto.createHash("sha256").update(`PAIR:${hubId}:${deviceId}:${clientNonce}`, "utf8").digest("hex");
  const num = parseInt(hashHex.slice(0, 8), 16) % 1e6;
  const padded = String(num).padStart(6, "0");
  return `${padded.slice(0, 3)}-${padded.slice(3, 6)}`;
}
function issueNewPairCode(ttlMs = 12e4) {
  const code = String(crypto.randomInt(1e5, 1e6));
  hubSecurityState.activePairCode = code;
  hubSecurityState.pairCodeExpiresAt = Date.now() + ttlMs;
  saveHubSecurityState();
  return { pairCode: code, expiresAt: hubSecurityState.pairCodeExpiresAt };
}
function isPairRateLimited(remoteIp) {
  const key = String(remoteIp || "unknown");
  const now = Date.now();
  const entry = pairRateLimitMap.get(key);
  if (!entry || now - entry.windowStart > 6e4) {
    pairRateLimitMap.set(key, { count: 0, windowStart: now });
    return false;
  }
  return entry.count >= 5;
}
function recordPairFailure(remoteIp) {
  const key = String(remoteIp || "unknown");
  const now = Date.now();
  const entry = pairRateLimitMap.get(key);
  if (!entry || now - entry.windowStart > 6e4) {
    pairRateLimitMap.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
}
function emitHubIpcEvent(eventObj) {
  try {
    console.log(`[HUB_IPC] ${JSON.stringify(eventObj)}`);
  } catch {
  }
}
function approveDevicePairing(ws, deviceInfo) {
  const deviceId = String(deviceInfo.deviceId || "").trim();
  if (!deviceId) return null;
  const deviceSecret = crypto.randomBytes(32).toString("hex");
  hubSecurityState.pairedDevices[deviceId] = {
    deviceId,
    deviceName: String(deviceInfo.deviceName || "POS Terminal"),
    branchId: String(deviceInfo.branchId || hubBranchId),
    tenantId: String(deviceInfo.tenantId || hubTenantId),
    deviceSecret,
    pairedAt: Date.now(),
    lastSeenAt: Date.now(),
    revoked: false
  };
  saveHubSecurityState();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.isAuthenticated = true;
    ws.pairedDeviceId = deviceId;
    ws.pairedDeviceSecret = deviceSecret;
    ws.authNonce = "";
    try {
      ws.send(JSON.stringify({
        type: "PAIR_APPROVED",
        action: "PAIR_APPROVED",
        hubId: hubSecurityState.hubId,
        hub_id: hubSecurityState.hubId,
        branchId: hubBranchId,
        branch_id: hubBranchId,
        branchName: hubBranchName,
        branch_name: hubBranchName,
        tenantId: hubTenantId,
        tenant_id: hubTenantId,
        deviceSecret,
        version: HUB_VERSION,
        hub_runtime: HUB_RUNTIME,
        ota_slot: HUB_OTA_SLOT,
        mdnsHost: getHubMdnsHost(),
        lanIps: getHubLanIps(),
        port: PORT,
        ...getHubFailoverMeta(),
        serverTime: Date.now()
      }));
    } catch {
    }
  }
  pendingPairRequests.delete(deviceId);
  console.log(`[Termux Hub] \u{1F510} Paired device "${deviceInfo.deviceName || deviceId}" (${deviceId}) cleanly.`);
  return hubSecurityState.pairedDevices[deviceId];
}
function isLocalhostRequest(req) {
  const addr = String(req.socket?.remoteAddress || "");
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}
function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      if (body.length < 65536) body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}
loadHubSecurityState();
var server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.url === "/ping" || req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        status: "ok",
        hub: "Termux-Local-Hub-Saimetric",
        hubId: hubSecurityState.hubId,
        version: HUB_VERSION,
        hubRuntime: HUB_RUNTIME,
        otaSlot: HUB_OTA_SLOT,
        authRequired: HUB_REQUIRE_AUTH,
        pairedDevicesCount: Object.values(hubSecurityState.pairedDevices).filter((d) => d && !d.revoked).length,
        branchId: hubBranchId,
        branchName: hubBranchName,
        tenantId: hubTenantId,
        mdnsHost: getHubMdnsHost(),
        lanIps: getHubLanIps(),
        port: PORT,
        ...getHubFailoverMeta(),
        salesCount: salesStore.length,
        directGrvsCount: directGrvsStore.length,
        inventoryCount: inventoryStore.length,
        staffCount: salespeopleStore.length,
        customerCount: customersStore.length,
        branchesCount: branchesStore.length,
        cashAccountsCount: cashAccountsStore.length,
        tombstonesCount: tombstonesStore.length,
        uptime: process.uptime()
      })
    );
  }
  if (req.url === "/hub-info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(
      JSON.stringify({
        type: "HUB_INFO",
        action: "HUB_INFO",
        hubId: hubSecurityState.hubId,
        tenantId: hubTenantId,
        branchId: hubBranchId,
        branch_id: hubBranchId,
        branch_name: hubBranchName,
        tenant_id: hubTenantId,
        hub_id: hubSecurityState.hubId,
        mdnsHost: getHubMdnsHost(),
        lanIps: getHubLanIps(),
        port: PORT,
        version: HUB_VERSION,
        hub_runtime: HUB_RUNTIME,
        ota_slot: HUB_OTA_SLOT,
        auth_required: HUB_REQUIRE_AUTH,
        ...getHubFailoverMeta(),
        totalRecords: salesStore.length + directGrvsStore.length,
        casualWorkersCount: casualWorkersStore.length,
        branchesCount: branchesStore.length,
        cashAccountsCount: cashAccountsStore.length,
        tombstonesCount: tombstonesStore.length,
        timestamp: Date.now()
      })
    );
  }
  if (req.url && req.url.startsWith("/local-admin/")) {
    if (!isLocalhostRequest(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Localhost access only" }));
    }
    if (req.method === "GET" && req.url === "/local-admin/security-state") {
      const now = Date.now();
      const safeDevices = Object.values(hubSecurityState.pairedDevices).map((d) => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        branchId: d.branchId,
        pairedAt: d.pairedAt,
        lastSeenAt: d.lastSeenAt,
        revoked: Boolean(d.revoked)
      }));
      const pending = Array.from(pendingPairRequests.values()).filter((p) => now - p.createdAt < 12e4).map((p) => ({
        deviceId: p.deviceId,
        deviceName: p.deviceName,
        branchId: p.branchId,
        confirmCode: p.confirmCode,
        createdAt: p.createdAt
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        hubId: hubSecurityState.hubId,
        branchId: hubBranchId,
        branchName: hubBranchName,
        tenantId: hubTenantId,
        version: HUB_VERSION,
        hubRuntime: HUB_RUNTIME,
        otaSlot: HUB_OTA_SLOT,
        authRequired: HUB_REQUIRE_AUTH,
        activePairCode: hubSecurityState.pairCodeExpiresAt > now ? hubSecurityState.activePairCode : null,
        pairCodeExpiresAt: hubSecurityState.pairCodeExpiresAt > now ? hubSecurityState.pairCodeExpiresAt : 0,
        pairedDevices: safeDevices,
        pendingApprovals: pending
      }));
    }
    if (req.method === "POST" && req.url === "/local-admin/pair-code") {
      const issued = issueNewPairCode(12e4);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ hubId: hubSecurityState.hubId, ...issued }));
    }
    if (req.method === "POST" && req.url === "/local-admin/approve-pair") {
      const body = await readJsonBody(req);
      const pending = pendingPairRequests.get(String(body.deviceId || ""));
      if (!pending) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Pending pairing request not found or expired" }));
      }
      approveDevicePairing(pending.ws, pending);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, deviceId: pending.deviceId }));
    }
    if (req.method === "POST" && req.url === "/local-admin/reject-pair") {
      const body = await readJsonBody(req);
      const pending = pendingPairRequests.get(String(body.deviceId || ""));
      if (pending) {
        try {
          if (pending.ws && pending.ws.readyState === WebSocket.OPEN) {
            pending.ws.send(JSON.stringify({
              type: "PAIR_REJECTED",
              action: "PAIR_REJECTED",
              reason: String(body.reason || "Pairing rejected on Local Hub.")
            }));
          }
        } catch {
        }
        pendingPairRequests.delete(pending.deviceId);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true }));
    }
    if (req.method === "POST" && req.url === "/local-admin/revoke-device") {
      const body = await readJsonBody(req);
      const targetId = String(body.deviceId || "").trim();
      if (targetId && hubSecurityState.pairedDevices[targetId]) {
        hubSecurityState.pairedDevices[targetId].revoked = true;
        saveHubSecurityState();
        wss.clients.forEach((client) => {
          if (client.pairedDeviceId === targetId && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({ type: "AUTH_FAILED", reason: "Device pairing was revoked on the Local Hub." }));
              client.close(4003, "Device revoked");
            } catch {
            }
          }
        });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true, revokedDeviceId: targetId }));
    }
    if (req.method === "POST" && req.url === "/local-admin/broadcast-updating") {
      const body = await readJsonBody(req);
      const notice = JSON.stringify({
        type: "HUB_UPDATING",
        action: "HUB_UPDATING",
        targetVersion: String(body.targetVersion || ""),
        etaSeconds: Number(body.etaSeconds || 6),
        timestamp: Date.now()
      });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(notice);
          } catch {
          }
        }
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ success: true }));
    }
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});
function getHubCashLogRef(log) {
  if (!log || typeof log !== "object") return "";
  const direct = String(log.reference || log.Reference || "").trim();
  if (direct) return direct;
  const text = `${log.description || log.Description || ""} ${log.notes || ""}`;
  const m = text.match(/#([A-Za-z0-9_-]+)/);
  return m && m[1] ? m[1].trim() : "";
}
function getHubCashLogSemanticKey(log) {
  const ref = getHubCashLogRef(log).toUpperCase();
  if (!ref) return null;
  const idStr = String(log.id || log.cashLogId || "").toUpperCase();
  const line = String(log.line || log.Line || "").toLowerCase();
  const cat = String(log.category || "").toLowerCase();
  const desc = String(log.description || log.Description || "").toLowerCase();
  const cur = String(log.currency || "").toLowerCase();
  const comp = String(log.company_id || log.companyId || "COMP-001").trim().toUpperCase();
  const br = String(log.branch_id || log.branchId || "BR-MAIN").trim().toUpperCase();
  if (idStr.startsWith("CL-REF-") || cat === "refund" || line.includes("refund") || desc.includes("cash refund")) {
    return `${comp}::${br}::REF::${ref}`;
  }
  if (idStr.startsWith("CL-VOID-") || line.includes("void") || desc.includes("cash reversal for voided")) {
    return `${comp}::${br}::VOID::${ref}`;
  }
  if (idStr.startsWith("CL-CSH-") || line.includes("cash sale")) {
    return `${comp}::${br}::CSH::${ref}`;
  }
  if (idStr.startsWith("CL-CRDEP-") || line.includes("credit deposit")) {
    return `${comp}::${br}::CRDEP::${ref}`;
  }
  const isW = idStr.startsWith("CL-WDR-") || log.isWithdrawal === true || log.isWithdrawal === "true" || line.includes("withdrawal") || cat.includes("withdrawal") || desc.includes("withdrawal") || desc.includes("cash-out");
  let curBucket = "";
  if (cur.includes("eco") || line.includes("eco") || cat.includes("eco") || desc.includes("ecocash")) {
    curBucket = "ECOCASH";
  } else if (cur.includes("zig") || line.includes("zig") || cat.includes("zig") || desc.includes("zig")) {
    curBucket = "ZIG";
  } else {
    const rawCur = String(log.currency || "").trim().toUpperCase();
    if (rawCur && rawCur !== "USD") curBucket = rawCur;
  }
  if (!curBucket && !isW) return null;
  return `${comp}::${br}::${isW ? "WDR" : "NCSALE"}::${ref}::${curBucket || "FX"}`;
}
function deduplicateHubCashLogs(logs) {
  if (!Array.isArray(logs)) return [];
  const score = (l) => {
    let s = 0;
    const id = String(l?.id || l?.cashLogId || "");
    if (id.startsWith("CL-WDR-") || id.startsWith("CL-SALE-") || id.startsWith("CL-CSH-") || id.startsWith("CL-CRDEP-") || id.startsWith("CL-REF-") || id.startsWith("CL-VOID-")) {
      s += 100;
    }
    if (l?.isRefunded || l?.isVoided || l?.isFlaggedMobileReversal) s += 25;
    if (l?.reference || l?.Reference) s += 10;
    if (l?.currency) s += 5;
    if (typeof l?.isWithdrawal === "boolean") s += 5;
    return s;
  };
  const out = [];
  const byId = /* @__PURE__ */ new Map();
  const bySem = /* @__PURE__ */ new Map();
  for (const item of logs) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || item.cashLogId || "").trim();
    const sem = getHubCashLogSemanticKey(item);
    if (id && byId.has(id)) {
      const idx2 = byId.get(id);
      if (score(item) >= score(out[idx2])) out[idx2] = { ...out[idx2], ...item };
      continue;
    }
    if (sem && bySem.has(sem)) {
      const idx2 = bySem.get(sem);
      if (score(item) >= score(out[idx2])) {
        out[idx2] = { ...out[idx2], ...item };
        if (id) byId.set(id, idx2);
      }
      continue;
    }
    const idx = out.length;
    out.push(item);
    if (id) byId.set(id, idx);
    if (sem) bySem.set(sem, idx);
  }
  return out;
}
function stripHubStockMovementDupSuffix(id) {
  return String(id || "").trim().replace(/(?:-dup-\d+-\d{4})+$/gi, "");
}
function deduplicateHubStockMovements(movements) {
  if (!Array.isArray(movements)) return [];
  const out = [];
  const seenExactIds = /* @__PURE__ */ new Set();
  const seenBaseItemKeys = /* @__PURE__ */ new Set();
  for (const item of movements) {
    if (!item || typeof item !== "object") continue;
    const rawId = String(item.id || item.movementId || item.txnId || "").trim();
    if (!rawId) continue;
    const baseId = stripHubStockMovementDupSuffix(rawId);
    const itemId = String(item.itemId || "").trim();
    const isDupId = rawId !== baseId;
    const baseItemKey = `${baseId}::${itemId}`;
    if (seenExactIds.has(rawId) || isDupId && seenBaseItemKeys.has(baseItemKey)) {
      continue;
    }
    let finalId = rawId;
    if (isDupId && !seenExactIds.has(baseId) && !movements.some((other) => {
      const oId = String(other?.id || other?.movementId || other?.txnId || "").trim();
      return oId === baseId;
    })) {
      finalId = baseId;
    }
    seenExactIds.add(rawId);
    seenExactIds.add(finalId);
    seenBaseItemKeys.add(baseItemKey);
    out.push({
      ...item,
      id: item.id || finalId,
      movementId: item.movementId && !isDupId ? item.movementId : finalId,
      txnId: item.txnId && !isDupId ? item.txnId : finalId
    });
  }
  return out;
}
function upsertHubCashLog(rawLog, incomingCloudSynced = false) {
  if (!rawLog || typeof rawLog !== "object") return null;
  const log = {
    ...rawLog,
    id: rawLog.id || rawLog.cashLogId,
    timestamp: rawLog.timestamp ?? rawLog.Timestamp,
    date: rawLog.date ?? rawLog.Date,
    staffId: rawLog.staffId ?? rawLog.StaffID,
    staffName: rawLog.staffName ?? rawLog.StaffName,
    line: rawLog.line ?? rawLog.Line,
    description: rawLog.description ?? rawLog.Description,
    in: rawLog.in !== void 0 ? rawLog.in : rawLog.In,
    out: rawLog.out !== void 0 ? rawLog.out : rawLog.Out,
    reference: rawLog.reference ?? rawLog.Reference ?? (getHubCashLogRef(rawLog) || void 0)
  };
  const logId = log.id;
  const semKey = getHubCashLogSemanticKey(log);
  if (!logId && !semKey) return null;
  const exByIdIdx = logId ? cashLogsStore.findIndex((l) => l.id === logId || l.cashLogId === logId) : -1;
  const exBySemIdx = semKey ? cashLogsStore.findIndex((l) => getHubCashLogSemanticKey(l) === semKey) : -1;
  const exIdx = exByIdIdx >= 0 ? exByIdIdx : exBySemIdx;
  const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && cashLogsStore[exIdx].isCloudSynced === true;
  if (exIdx >= 0) {
    cashLogsStore[exIdx] = {
      ...cashLogsStore[exIdx],
      ...log,
      id: cashLogsStore[exIdx].id || logId,
      ...resolvedCloudSynced ? { isCloudSynced: true } : {}
    };
  } else if (logId) {
    cashLogsStore.unshift({ ...log, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
    console.log(`[Termux Hub] \u{1F4E5} Accepted Cash Log [${log.line || logId}] (Append-Only)`);
  }
  return logId || semKey;
}
function normalizeHubEntityType(rawType) {
  const norm = String(rawType || "").trim().toLowerCase();
  if (norm === "inventory" || norm === "inventory_item" || norm === "inventory_items" || norm === "inventorymaster" || norm === "product" || norm === "products") {
    return "inventory_item";
  }
  if (norm === "customer" || norm === "customers") return "customer";
  if (norm === "staff" || norm === "salesperson" || norm === "salespeople" || norm === "user" || norm === "users") return "staff";
  if (norm === "supplier" || norm === "suppliers") return "supplier";
  if (norm === "branch" || norm === "branches") return "branch";
  if (norm === "category" || norm === "categories" || norm === "inventory_category") return "inventory_category";
  if (norm === "cash_account" || norm === "cash_accounts" || norm === "cashaccounts") return "cash_account";
  if (norm === "credit_group" || norm === "credit_groups" || norm === "creditgroups") return "credit_group";
  if (norm === "casual_worker" || norm === "casual_workers" || norm === "casualworkers") return "casual_worker";
  if (norm === "stocktake_session" || norm === "stocktake_sessions" || norm === "stocktakesessions") return "stocktake_session";
  return norm;
}
function isHubT2EntityType(rawType) {
  const n = normalizeHubEntityType(rawType);
  if ([
    "inventory_item",
    "customer",
    "staff",
    "supplier",
    "branch",
    "inventory_category",
    "cash_account",
    "credit_group",
    "casual_worker",
    "stocktake_session"
  ].includes(n)) {
    return true;
  }
  const canon = mapHubEntityToCanonicalType(rawType);
  return Array.isArray(hubRuntimePolicy.t2EntityTypes) && (hubRuntimePolicy.t2EntityTypes.includes(n) || hubRuntimePolicy.t2EntityTypes.includes(canon));
}
function getTombstoneRecordId(rec, norm) {
  if (!rec) return "";
  if (typeof rec === "string" || typeof rec === "number") return String(rec).trim();
  const n = normalizeHubEntityType(norm);
  if (n === "inventory_item") return String(rec.itemId || rec.ItemID || rec.id || "").trim();
  if (n === "customer") return String(rec.customerId || rec.id || "").trim();
  if (n === "staff") return String(rec.id || rec.staffId || "").trim();
  if (n === "supplier") return String(rec.supplierId || rec.SupplierID || rec.id || "").trim();
  if (n === "branch") return String(rec.branchId || rec.branch_id || rec.id || "").trim();
  if (n === "inventory_category") return String(rec.categoryId || rec.id || rec.categoryName || rec.name || "").trim();
  if (n === "cash_account") return String(rec.account_id || rec.id || "").trim();
  if (n === "credit_group") return String(rec.groupId || rec.id || "").trim();
  if (n === "casual_worker") return String(rec.id || rec.pin_hash || "").trim();
  if (n === "stocktake_session") return String(rec.sessionId || rec.id || "").trim();
  return String(getEntityId(rec, norm) || rec._entityId || rec.id || "").trim();
}
function isCatalogTombstoneType(rawType) {
  const n = normalizeHubEntityType(rawType);
  if ([
    "inventory_item",
    "customer",
    "staff",
    "supplier",
    "branch",
    "inventory_category",
    "credit_group",
    "casual_worker"
  ].includes(n)) {
    return true;
  }
  return isHubGlobalBranchEntityType(n) || isHubGlobalBranchEntityType(mapHubEntityToCanonicalType(rawType));
}
function findHubTombstone(entityId, entityType) {
  const cleanId = String(entityId || "").trim().toUpperCase();
  if (!cleanId) return null;
  const cleanType = entityType ? normalizeHubEntityType(entityType) : "";
  let newest = null;
  let newestTs = -1;
  for (const t of tombstonesStore) {
    if (!t || !t.entityId) continue;
    if (String(t.entityId).trim().toUpperCase() !== cleanId) continue;
    if (cleanType && normalizeHubEntityType(t.entityType) !== cleanType) continue;
    const ts = Number(t.deletedAt) || getTimestamp(t) || 0;
    if (ts >= newestTs) {
      newestTs = ts;
      newest = t;
    }
  }
  return newest;
}
function isTombstoned(entityId, entityType, incomingTs) {
  const tomb = findHubTombstone(entityId, entityType);
  if (!tomb) return false;
  const deletedAt = Number(tomb.deletedAt) || getTimestamp(tomb) || 0;
  if (incomingTs === void 0 || incomingTs === null) return true;
  const recTs = Number(incomingTs) || 0;
  if (recTs <= 0) return true;
  return deletedAt > recTs;
}
function purgeEntityFromHubStores(entityType, entityId, tombstoneDeletedAt) {
  const cleanUpper = String(entityId || "").trim().toUpperCase();
  if (!cleanUpper) return false;
  const norm = normalizeHubEntityType(entityType);
  let purged = false;
  const removeFrom = (arr, idFn) => {
    const before = arr.length;
    const kept = arr.filter((item) => {
      if (!item) return false;
      const candidate = String(idFn(item) || "").trim().toUpperCase();
      if (candidate !== cleanUpper) return true;
      if (tombstoneDeletedAt !== void 0) {
        const itemTs = getTimestamp(item);
        if (itemTs > tombstoneDeletedAt + 12e4) return true;
      }
      return false;
    });
    if (kept.length !== before) purged = true;
    return kept;
  };
  if (!norm || norm === "inventory_item") {
    inventoryStore = removeFrom(inventoryStore, (i) => i.itemId || i.ItemID || i.id);
  }
  if (!norm || norm === "customer") {
    customersStore = removeFrom(customersStore, (c) => c.customerId || c.id);
  }
  if (!norm || norm === "staff") {
    salespeopleStore = removeFrom(salespeopleStore, (s) => s.id || s.staffId);
  }
  if (!norm || norm === "supplier") {
    suppliersStore = removeFrom(suppliersStore, (s) => s.supplierId || s.SupplierID || s.id);
  }
  if (!norm || norm === "branch") {
    branchesStore = removeFrom(branchesStore, (b) => b.branchId || b.branch_id || b.id);
  }
  if (!norm || norm === "inventory_category") {
    categoriesStore = removeFrom(categoriesStore, (c) => c.categoryId || c.id || c.categoryName);
  }
  if (!norm || norm === "cash_account") {
    cashAccountsStore = removeFrom(cashAccountsStore, (a) => a.account_id || a.id);
  }
  if (!norm || norm === "credit_group") {
    creditGroupsStore = removeFrom(creditGroupsStore, (g) => g.groupId || g.id);
  }
  if (!norm || norm === "casual_worker") {
    casualWorkersStore = removeFrom(casualWorkersStore, (w) => w.id || w.pin_hash);
  }
  if (!norm || norm === "stocktake_session") {
    stocktakeSessionsStore = removeFrom(stocktakeSessionsStore, (s) => s.sessionId || s.id);
    const segBefore = stocktakeSegmentsStore.length;
    stocktakeSegmentsStore = stocktakeSegmentsStore.filter(
      (seg) => !seg || String(seg.sessionId || "").trim().toUpperCase() !== cleanUpper
    );
    if (stocktakeSegmentsStore.length !== segBefore) purged = true;
    const zoneBefore = zoneAssignmentsStore.length;
    zoneAssignmentsStore = zoneAssignmentsStore.filter(
      (z) => !z || String(z.sessionId || "").trim().toUpperCase() !== cleanUpper
    );
    if (zoneAssignmentsStore.length !== zoneBefore) purged = true;
    if (branchLockdownsStore && typeof branchLockdownsStore === "object") {
      const releaseNow = Date.now();
      const releaseIso = new Date(releaseNow).toISOString();
      for (const brKey of Object.keys(branchLockdownsStore)) {
        const lk = branchLockdownsStore[brKey];
        if (lk && lk.isLocked && String(lk.sessionId || "").trim().toUpperCase() === cleanUpper) {
          const unlockedState = {
            ...lk,
            branchId: lk.branchId || brKey,
            isLocked: false,
            lockedAt: void 0,
            reason: `Auto-released: stocktake session ${cleanUpper} was deleted`,
            updatedAt: releaseNow,
            lastUpdated: releaseIso,
            isCloudSynced: false
          };
          branchLockdownsStore[brKey] = unlockedState;
          purged = true;
          try {
            if (typeof wss !== "undefined" && wss && wss.clients) {
              const unlockMsg = JSON.stringify({
                type: "STOCKTAKE_LOCKDOWN_BROADCAST",
                action: "STOCKTAKE_LOCKDOWN_BROADCAST",
                ...unlockedState,
                origin_device_id: "LOCAL_HUB",
                timestamp: releaseNow
              });
              wss.clients.forEach((client) => {
                if (client && client.readyState === WebSocket.OPEN) {
                  try {
                    client.send(unlockMsg);
                  } catch (e) {
                  }
                }
              });
            }
          } catch (e) {
          }
        }
      }
    }
  }
  if (genericEntitiesStore && typeof genericEntitiesStore === "object") {
    const canonGen = entityType ? mapHubEntityToCanonicalType(entityType) : "";
    const targetBuckets = !norm ? Object.keys(genericEntitiesStore) : Array.from(new Set([norm, canonGen].filter(Boolean)));
    for (const bKey of targetBuckets) {
      const bucket = genericEntitiesStore[bKey];
      if (!bucket || typeof bucket !== "object") continue;
      for (const recKey of Object.keys(bucket)) {
        const rec = bucket[recKey];
        if (!rec) continue;
        const candidateId = String(rec._entityId || rec.id || recKey || "").trim().toUpperCase();
        if (candidateId !== cleanUpper && String(recKey).trim().toUpperCase() !== cleanUpper) continue;
        if (tombstoneDeletedAt !== void 0) {
          const itemTs = Number(rec._updatedAt || getTimestamp(rec)) || 0;
          if (itemTs > tombstoneDeletedAt + 12e4) continue;
        }
        delete bucket[recKey];
        purged = true;
      }
    }
  }
  return purged;
}
function recordAndPurgeHubTombstone(entityType, entityId, deletedAt, extra = {}) {
  const cleanId = String(entityId || "").trim();
  const normType = normalizeHubEntityType(entityType);
  if (!cleanId || !normType) return null;
  const now = Date.now();
  const ts = Number(deletedAt) || now;
  const tId = extra.id || `TOMB-${normType}-${cleanId}`;
  const exIdx = tombstonesStore.findIndex(
    (t) => t && (t.id === tId || normalizeHubEntityType(t.entityType) === normType && String(t.entityId || "").trim().toUpperCase() === cleanId.toUpperCase())
  );
  const existingTs = exIdx >= 0 ? Number(tombstonesStore[exIdx].deletedAt) || 0 : 0;
  const finalTs = Math.max(ts, existingTs);
  const stampedTomb = {
    ...extra,
    id: tId,
    entityType: normType,
    entityId: cleanId,
    isDeleted: true,
    deletedAt: finalTs,
    updatedAt: finalTs,
    hubTimestamp: now
  };
  if (exIdx >= 0) {
    tombstonesStore[exIdx] = stampedTomb;
  } else {
    tombstonesStore.unshift(stampedTomb);
  }
  purgeEntityFromHubStores(normType, cleanId, finalTs);
  return stampedTomb;
}
function getStoreByEntityType(norm) {
  switch (norm) {
    case "sales":
    case "sale":
      return salesStore;
    case "customer_changes":
    case "customer_change":
      return customerChangesStore;
    case "credit_sales":
    case "credit_sale":
      return creditSalesStore;
    case "cash_logs":
    case "cash_log":
      return cashLogsStore;
    case "stock_movements":
    case "stock_movement":
      return stockMovementsStore;
    case "direct_grvs":
    case "direct_grv":
    case "grv":
      return directGrvsStore;
    case "expenses":
    case "expense":
      return expensesStore;
    case "inventory":
    case "inventory_item":
    case "products":
      return inventoryStore;
    case "customers":
    case "customer":
      return customersStore;
    case "staff":
    case "salespeople":
    case "users":
      return salespeopleStore;
    case "suppliers":
    case "supplier":
      return suppliersStore;
    case "branches":
    case "branch":
      return branchesStore;
    case "cash_accounts":
    case "cash_account":
      return cashAccountsStore;
    case "tombstones":
    case "tombstone":
      return tombstonesStore;
    case "categories":
    case "category":
    case "inventory_category":
      return categoriesStore;
    default: {
      if (genericEntitiesStore && typeof genericEntitiesStore === "object") {
        const directBucket = genericEntitiesStore[norm];
        if (directBucket && typeof directBucket === "object") return Object.values(directBucket);
        const canonKey = mapHubEntityToCanonicalType(norm);
        const canonBucket = canonKey ? genericEntitiesStore[canonKey] : null;
        if (canonBucket && typeof canonBucket === "object") return Object.values(canonBucket);
      }
      return [];
    }
  }
}
function getEntityId(rec, norm) {
  if (!rec) return null;
  switch (norm) {
    case "sales":
    case "sale":
      return rec.id || rec.invoice_id || rec.invoiceId;
    case "customer_changes":
    case "customer_change":
      return rec.id || rec.changeId;
    case "credit_sales":
    case "credit_sale":
      return rec.id || rec.creditId;
    case "cash_logs":
    case "cash_log":
      return rec.id || (rec.date && rec.timestamp ? `${rec.date}_${rec.timestamp}` : null);
    case "stock_movements":
    case "stock_movement":
      return rec.id || rec.txnId || rec.movementId;
    case "direct_grvs":
    case "direct_grv":
    case "grv":
      return rec.id || rec.grvId || rec.reference;
    case "expenses":
    case "expense":
      return rec.id;
    case "inventory":
    case "inventory_item":
    case "products":
      return rec.itemId || rec.id;
    case "customers":
    case "customer":
      return rec.customerId || rec.id;
    case "staff":
    case "salespeople":
    case "users":
      return rec.id;
    case "suppliers":
    case "supplier":
      return rec.supplierId || rec.SupplierID || rec.id;
    case "branches":
    case "branch":
      return canonicalizeHubBranchId(rec.branchId || rec.branch_id || rec.BranchID || rec.id);
    case "cash_accounts":
    case "cash_account":
      return rec.account_id || rec.id;
    case "tombstones":
    case "tombstone":
      return rec.entityId || rec.id;
    case "categories":
    case "category":
    case "inventory_category":
      return rec.categoryId || rec.id || rec.categoryName;
    default:
      return rec._entityId || rec.id || rec.entityId || null;
  }
}
function getRecordTimestamp(rec) {
  if (!rec) return 0;
  const val = rec.updatedAt || rec.lastUpdated || rec.hubTimestamp || rec.deletedAt || rec.timestamp || rec.date || rec.createdAt;
  if (typeof val === "number") return val;
  if (!val) return 0;
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? 0 : parsed;
}
function getRecordTotal(rec, norm) {
  if (!rec) return 0;
  switch (norm) {
    case "sales":
    case "sale":
      return rec.status === "Voided" || rec.status === "Refunded" ? 0 : Number(rec.total) || 0;
    case "customer_changes":
    case "customer_change":
      return (Number(rec.in) || 0) - (Number(rec.out) || 0);
    case "credit_sales":
    case "credit_sale":
      return (Number(rec.out ?? rec.amount) || 0) - (Number(rec.in) || 0);
    case "cash_logs":
    case "cash_log":
      return (Number(rec.in) || 0) - (Number(rec.out) || 0);
    case "stock_movements":
    case "stock_movement":
      return Number(rec.quantity || rec.qty) || 0;
    case "direct_grvs":
    case "direct_grv":
    case "grv":
      return Number(rec.totalAmount || rec.total) || 0;
    case "expenses":
    case "expense":
      return Number(rec.amount) || 0;
    case "inventory":
    case "inventory_item":
    case "products":
      return Number(rec.totalUnits || rec.stockSingles) || 0;
    case "customers":
    case "customer":
      return Number(rec.creditLimit) || 0;
    case "cash_accounts":
    case "cash_account":
      return Number(rec.balance ?? rec.current_balance) || 0;
    case "tombstones":
    case "tombstone":
      return 0;
    default:
      return Number(rec.total ?? rec.totalAmount ?? rec.amount ?? rec.points ?? 0) || 0;
  }
}
function queryHubEntities(queryOpts = {}) {
  const rawType = String(queryOpts.entityType || queryOpts.entity || "").trim().toLowerCase();
  if (!rawType) {
    return { entityType: "", records: [], count: 0, totalMatched: 0, truncated: false };
  }
  const canonType = mapHubEntityToCanonicalType(rawType);
  const reqComp = String(queryOpts.companyId || queryOpts.company_id || hubTenantId || "COMP-001").trim().toUpperCase();
  const reqBranchRaw = String(queryOpts.branchId || queryOpts.branch_id || queryOpts.branchCode || "ALL").trim().toUpperCase();
  const reqBranch = reqBranchRaw || "ALL";
  const dateFromMs = queryOpts.dateFrom ? typeof queryOpts.dateFrom === "number" ? queryOpts.dateFrom : new Date(queryOpts.dateFrom).getTime() : 0;
  const dateToMs = queryOpts.dateTo ? typeof queryOpts.dateTo === "number" ? queryOpts.dateTo : new Date(queryOpts.dateTo).getTime() : Infinity;
  const filterStatus = queryOpts.status ? String(queryOpts.status).trim().toLowerCase() : "";
  const limitNum = Math.min(1e3, Math.max(1, Number(queryOpts.limit) || 200));
  const getStoreForQuery = () => {
    const primary = getStoreByEntityType(rawType);
    if (primary.length > 0) return primary;
    const byCanon = getStoreByEntityType(canonType);
    if (byCanon.length > 0) return byCanon;
    switch (canonType) {
      case "cash_lift":
        return cashLiftsStore;
      case "cash_movement":
        return cashMovementsStore;
      case "cash_transfer":
        return cashTransfersStore;
      case "cash_account":
        return cashAccountsStore;
      case "credit_group":
        return creditGroupsStore;
      case "internal_consumption":
        return internalConsumptionsStore;
      case "admin_sale":
        return adminSalesStore;
      case "cash_count":
        return cashCountsStore;
      case "supplier_invoice_voucher":
        return vouchersStore;
      case "business_day_closure":
        return businessDayClosuresStore;
      case "electronic_settlement":
        return electronicSettlementsStore;
      case "casual_worker":
        return casualWorkersStore;
      case "stocktake_session":
        return stocktakeSessionsStore;
      case "stocktake_segment":
        return stocktakeSegmentsStore;
      case "stocktake_zone_assignment":
        return zoneAssignmentsStore;
      default:
        return [];
    }
  };
  const sourceList = getStoreForQuery();
  const isGlobal = isHubGlobalBranchEntityType(canonType) || isHubGlobalBranchEntityType(rawType);
  const isT2 = isHubT2EntityType(canonType) || isCanonicalT2Type(canonType);
  const matched = [];
  for (const rec of sourceList) {
    if (!rec || typeof rec !== "object") continue;
    const recComp = String(rec.companyId || rec.company_id || hubTenantId || "COMP-001").trim().toUpperCase();
    if (reqComp !== "ALL" && recComp !== reqComp) continue;
    if (!isGlobal && reqBranch !== "ALL") {
      const recBranch = String(rec.branchId || rec.branch_id || rec.branchCode || hubBranchId || "").trim().toUpperCase();
      if (recBranch && recBranch !== "ALL" && recBranch !== reqBranch) continue;
    }
    const id = getEntityId(rec, canonType) || rec._entityId || rec.id;
    const recTs = getRecordTimestamp(rec);
    if (isT2 && id && isTombstoned(id, canonType, recTs)) continue;
    if (dateFromMs > 0 && Number.isFinite(dateFromMs) && recTs > 0 && recTs < dateFromMs) continue;
    if (Number.isFinite(dateToMs) && recTs > 0 && recTs > dateToMs) continue;
    if (filterStatus && String(rec.status || "").trim().toLowerCase() !== filterStatus) continue;
    const safeRec = { ...rec };
    if ("pin" in safeRec) delete safeRec.pin;
    if ("rawPin" in safeRec) delete safeRec.rawPin;
    if ("password" in safeRec) delete safeRec.password;
    if ("passwordHash" in safeRec) delete safeRec.passwordHash;
    matched.push(safeRec);
  }
  matched.sort((a, b) => getRecordTimestamp(b) - getRecordTimestamp(a));
  const totalMatched = matched.length;
  const sliced = matched.slice(0, limitNum);
  return {
    entityType: canonType,
    records: sliced,
    count: sliced.length,
    totalMatched,
    truncated: totalMatched > sliced.length
  };
}
function computeIdsChecksum(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return "00000000";
  const sorted = [...ids].sort();
  let hash = 2166136261;
  for (const id of sorted) {
    const str = String(id);
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 124;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function computeHubSnapshot(entityType, startDate, endDate) {
  const norm = String(entityType || "").toLowerCase().trim();
  const startTime = startDate ? new Date(startDate).getTime() : 0;
  const endTime = endDate ? new Date(endDate).getTime() : Infinity;
  const inRange = (t) => {
    if (!t || isNaN(t) || t <= 0) return true;
    return t >= startTime && t <= endTime;
  };
  const store = getStoreByEntityType(norm);
  let count = 0;
  let totalSum = 0;
  const ids = [];
  for (const rec of store) {
    if (!rec) continue;
    const id = getEntityId(rec, norm);
    if (!id) continue;
    const t = getRecordTimestamp(rec);
    if (isHubT2EntityType(norm) && isTombstoned(id, norm, t)) continue;
    if (inRange(t)) {
      count++;
      totalSum += getRecordTotal(rec, norm);
      ids.push(String(id));
    }
  }
  const idHash = computeIdsChecksum(ids);
  return {
    entityType: norm,
    startDate,
    endDate,
    count,
    totalSum: Number(totalSum.toFixed(2)),
    idHash,
    generatedAt: Date.now()
  };
}
function computeHubDigest(entityType, startDate, endDate) {
  const norm = String(entityType || "").toLowerCase().trim();
  const startTime = startDate ? new Date(startDate).getTime() : 0;
  const endTime = endDate ? new Date(endDate).getTime() : Infinity;
  const inRange = (t) => {
    if (!t || isNaN(t) || t <= 0) return true;
    return t >= startTime && t <= endTime;
  };
  const items = [];
  let totalSum = 0;
  const store = getStoreByEntityType(norm);
  for (const rec of store) {
    if (!rec) continue;
    const id = getEntityId(rec, norm);
    if (!id) continue;
    const t = getRecordTimestamp(rec);
    if (isHubT2EntityType(norm) && isTombstoned(id, norm, t)) continue;
    if (inRange(t)) {
      const total = getRecordTotal(rec, norm);
      totalSum += total;
      items.push({
        id: String(id),
        total,
        status: rec.status,
        timestamp: t,
        updatedAt: rec.updatedAt || rec.lastUpdated ? getRecordTimestamp(rec) : void 0
      });
    }
  }
  return {
    entityType: norm,
    startDate,
    endDate,
    items,
    count: items.length,
    totalSum,
    generatedAt: Date.now()
  };
}
function computeDigestDiff(clientDigest, entityType) {
  if (!clientDigest || !Array.isArray(clientDigest.items)) {
    return [];
  }
  const norm = String(entityType || clientDigest.entityType || "").toLowerCase().trim();
  const startTime = clientDigest.startDate ? new Date(clientDigest.startDate).getTime() : 0;
  const endTime = clientDigest.endDate ? new Date(clientDigest.endDate).getTime() : Infinity;
  const inRange = (t) => {
    if (!t || isNaN(t) || t <= 0) return true;
    return t >= startTime && t <= endTime;
  };
  const clientMap = /* @__PURE__ */ new Map();
  for (const item of clientDigest.items) {
    if (item && item.id != null) {
      clientMap.set(String(item.id).trim(), item);
    }
  }
  const isT2 = isHubT2EntityType(norm);
  const store = getStoreByEntityType(norm);
  const missingOrOutdated = [];
  for (const rec of store) {
    if (!rec) continue;
    const id = getEntityId(rec, norm);
    if (!id) continue;
    const cleanId = String(id).trim();
    const hubRecTime = getRecordTimestamp(rec);
    if (isT2 && isTombstoned(cleanId, norm, hubRecTime)) continue;
    if (!inRange(hubRecTime)) continue;
    const clientItem = clientMap.get(cleanId);
    if (!clientItem) {
      missingOrOutdated.push(rec);
    } else if (isT2) {
      const hubUpdated = getRecordTimestamp(rec);
      const clientUpdated = clientItem.updatedAt || clientItem.timestamp || 0;
      if (hubUpdated - clientUpdated > 6e4) {
        missingOrOutdated.push(rec);
      }
    } else if (norm === "sales" || norm === "sale") {
      if (rec.status && clientItem.status && rec.status !== clientItem.status) {
        missingOrOutdated.push(rec);
      }
    } else if (norm === "customer_changes" || norm === "customer_change" || norm === "credit_sales" || norm === "credit_sale") {
      const hubTotal = getRecordTotal(rec, norm);
      const clientTotal = Number(clientItem.total) || 0;
      if (Math.abs(hubTotal - clientTotal) > 5e-3) {
        missingOrOutdated.push(rec);
      }
    } else if (norm === "expenses" || norm === "expense" || norm === "direct_grvs" || norm === "direct_grv" || norm === "grv" || norm === "internal_consumptions" || norm === "internal_consumption") {
      if (rec.status && clientItem.status && String(rec.status).toLowerCase() !== String(clientItem.status).toLowerCase()) {
        missingOrOutdated.push(rec);
      }
    }
  }
  return missingOrOutdated;
}
function computeClientMissingOnHub(clientDigest, entityType) {
  if (!clientDigest || !Array.isArray(clientDigest.items)) {
    return [];
  }
  const norm = String(entityType || clientDigest.entityType || "").toLowerCase().trim();
  const isT2 = isHubT2EntityType(norm);
  const store = getStoreByEntityType(norm);
  const hubMap = /* @__PURE__ */ new Map();
  for (const rec of store) {
    if (!rec) continue;
    const id = getEntityId(rec, norm);
    if (!id) continue;
    if (isT2 && isTombstoned(id, norm, getRecordTimestamp(rec))) continue;
    hubMap.set(String(id).trim(), rec);
  }
  const missingOnHubIds = [];
  for (const item of clientDigest.items) {
    if (!item || item.id == null) continue;
    const cleanId = String(item.id).trim();
    const clientTs = item.updatedAt || item.timestamp || 0;
    if (isT2 && isTombstoned(cleanId, norm, clientTs)) continue;
    const hubRec = hubMap.get(cleanId);
    if (!hubRec) {
      missingOnHubIds.push(cleanId);
    } else if (isT2) {
      const hubUpdated = getRecordTimestamp(hubRec);
      const clientUpdated = clientTs;
      if (clientUpdated - hubUpdated > 6e4) {
        missingOnHubIds.push(cleanId);
      }
    } else if (norm === "sales" || norm === "sale") {
      if (item.status && hubRec.status && item.status !== hubRec.status) {
        missingOnHubIds.push(cleanId);
      }
    } else if (norm === "customer_changes" || norm === "customer_change" || norm === "credit_sales" || norm === "credit_sale") {
      const hubTotal = getRecordTotal(hubRec, norm);
      const clientTotal = Number(item.total) || 0;
      if (Math.abs(hubTotal - clientTotal) > 5e-3) {
        missingOnHubIds.push(cleanId);
      }
    } else if (norm === "expenses" || norm === "expense" || norm === "direct_grvs" || norm === "direct_grv" || norm === "grv" || norm === "internal_consumptions" || norm === "internal_consumption") {
      if (item.status && hubRec.status && String(item.status).toLowerCase() !== String(hubRec.status).toLowerCase()) {
        missingOnHubIds.push(cleanId);
      }
    }
  }
  return missingOnHubIds;
}
function computeClientTombstonedItems(clientDigest, entityType) {
  if (!clientDigest || !Array.isArray(clientDigest.items)) {
    return [];
  }
  const norm = String(entityType || clientDigest.entityType || "").toLowerCase().trim();
  if (!isHubT2EntityType(norm)) {
    return [];
  }
  const canonicalType = normalizeHubEntityType(norm);
  const tombstonesToPush = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of clientDigest.items) {
    if (!item || item.id == null) continue;
    const cleanId = String(item.id).trim();
    const clientTs = item.updatedAt || item.timestamp || 0;
    if (isTombstoned(cleanId, canonicalType, clientTs)) {
      const tomb = findHubTombstone(cleanId, canonicalType);
      if (tomb) {
        const key = `${canonicalType}::${cleanId.toUpperCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          tombstonesToPush.push(tomb);
        }
      }
    }
  }
  return tombstonesToPush;
}
function streamReconBackfill(ws, sweepId, entityType, missingRecords) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (!missingRecords || missingRecords.length === 0) {
    console.log(`[Termux Hub] \u{1F9F9} No missing records found for "${entityType}" (sweep: ${sweepId}). In sync!`);
    return;
  }
  const CHUNK_SIZE = 25;
  const totalChunks = Math.ceil(missingRecords.length / CHUNK_SIZE);
  console.log(`[Termux Hub] \u{1F680} Streaming backfill for "${entityType}": ${missingRecords.length} records in ${totalChunks} chunk(s) (sweep: ${sweepId})`);
  let currentChunk = 0;
  function sendNextChunk() {
    if (ws.readyState !== WebSocket.OPEN || currentChunk >= totalChunks) {
      if (currentChunk >= totalChunks) {
        console.log(`[Termux Hub] \u2705 Completed backfill streaming for "${entityType}" (sweep: ${sweepId})`);
      }
      return;
    }
    const start = currentChunk * CHUNK_SIZE;
    const chunkRecords = missingRecords.slice(start, start + CHUNK_SIZE);
    const packet = {
      type: "RECON_BACKFILL_PAYLOAD",
      action: "RECON_BACKFILL_PAYLOAD",
      sweepId,
      entityType,
      records: chunkRecords.map((r) => {
        if (typeof r === "object" && r !== null) {
          return { ...r, hubTimestamp: Date.now() };
        }
        return r;
      }),
      chunkIndex: currentChunk,
      totalChunks,
      hubTimestamp: Date.now(),
      originDeviceId: `HUB-${hubBranchId}`,
      branchId: hubBranchId
    };
    try {
      ws.send(JSON.stringify(packet));
    } catch (err) {
      console.warn(`[Termux Hub] Error sending backfill chunk ${currentChunk + 1}/${totalChunks}:`, err.message);
      return;
    }
    currentChunk++;
    if (currentChunk < totalChunks) {
      setTimeout(sendNextChunk, 15);
    } else {
      console.log(`[Termux Hub] \u2705 Completed backfill streaming for "${entityType}" (sweep: ${sweepId})`);
    }
  }
  sendNextChunk();
}
function triggerClientReconSweep(clientWs, isSod = false) {
  if (!clientWs || clientWs.readyState !== WebSocket.OPEN) return;
  const sweepId = `sweep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const cold = isHubCold();
  const triggerPacket = {
    type: "RECON_SWEEP_TRIGGER",
    sweepId,
    isColdHub: cold,
    pushChunkSize: 25,
    targetEntities: [
      "tombstones",
      "branches",
      "staff",
      "cash_accounts",
      "customers",
      "inventory",
      "sales",
      "customer_changes",
      "credit_sales",
      "cash_logs",
      "stock_movements",
      "direct_grvs",
      "expenses"
    ],
    isSod: Boolean(isSod),
    useSnapshotFirst: true,
    hubTimestamp: Date.now(),
    originDeviceId: `HUB-${hubBranchId}`
  };
  try {
    clientWs.send(JSON.stringify(triggerPacket));
    console.log(`[Termux Hub] \u{1F9F9} Sent RECON_SWEEP_TRIGGER (${sweepId}${cold ? " [COLD HUB]" : ""}${isSod ? " [SOD]" : ""}) to POS terminal`);
  } catch (err) {
    console.warn("[Termux Hub] Failed to send RECON_SWEEP_TRIGGER:", err.message);
  }
}
function triggerAllClientsReconSweep() {
  console.log(`[Termux Hub] \u{1F9F9} Starting 30-min background reconciliation sweep across connected terminals...`);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      triggerClientReconSweep(client, false);
    }
  });
}
var terminalLastActivity = /* @__PURE__ */ new Map();
var wss = new WebSocketServer({ server });
var UNAUTH_ALLOWED_OUTBOUND = /* @__PURE__ */ new Set([
  "AUTH_CHALLENGE",
  "AUTH_OK",
  "AUTH_FAILED",
  "PAIR_PENDING",
  "PAIR_APPROVED",
  "PAIR_REJECTED",
  "HUB_INFO",
  "HUB_ROLE_STATUS",
  "PING",
  "PONG",
  "HUB_UPDATING",
  "HUB_UPDATE_STATUS"
]);
setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (HUB_REQUIRE_AUTH && !client.isAuthenticated) {
      const limitMs = client.hasPendingPair ? 12e4 : 3e4;
      if (client.connectedAt && now - client.connectedAt > limitMs) {
        try {
          client.send(JSON.stringify({ type: "AUTH_FAILED", reason: "Authentication/pairing timeout." }));
          client.close(4002, "Auth timeout");
        } catch {
        }
        return;
      }
    }
    if (client.lastActivityAt && now - client.lastActivityAt > 5e4) {
      try {
        client.terminate();
      } catch {
      }
      return;
    }
    try {
      client.send(JSON.stringify({ type: "PING", ts: now }));
    } catch {
    }
  });
}, 2e4);
wss.on("connection", (ws, req) => {
  const remoteIp = req.socket.remoteAddress;
  console.log(`[Termux Hub] \u{1F7E2} POS Terminal connected from ${remoteIp} (AuthRequired=${HUB_REQUIRE_AUTH})`);
  let terminalDeviceId = null;
  ws.isAuthenticated = !HUB_REQUIRE_AUTH;
  ws.authNonce = crypto.randomBytes(32).toString("hex");
  ws.connectedAt = Date.now();
  ws.lastActivityAt = Date.now();
  ws.hasPendingPair = false;
  ws.pairedDeviceId = null;
  ws.pairedDeviceSecret = null;
  if (HUB_REQUIRE_AUTH) {
    const rawWsSend = ws.send.bind(ws);
    ws.send = (data, ...rest) => {
      if (!ws.isAuthenticated) {
        try {
          const parsed = typeof data === "string" ? JSON.parse(data) : null;
          const outType = String(parsed?.type || parsed?.action || "").toUpperCase();
          if (!UNAUTH_ALLOWED_OUTBOUND.has(outType)) {
            return;
          }
        } catch {
          return;
        }
      }
      return rawWsSend(data, ...rest);
    };
  }
  try {
    ws.send(JSON.stringify({
      type: "AUTH_CHALLENGE",
      action: "AUTH_CHALLENGE",
      hubId: hubSecurityState.hubId,
      hub_id: hubSecurityState.hubId,
      branchId: hubBranchId,
      branch_id: hubBranchId,
      tenantId: hubTenantId,
      tenant_id: hubTenantId,
      nonce: ws.authNonce,
      timestamp: Date.now(),
      auth_required: HUB_REQUIRE_AUTH,
      version: HUB_VERSION,
      hub_runtime: HUB_RUNTIME,
      ota_slot: HUB_OTA_SLOT,
      mdnsHost: getHubMdnsHost(),
      lanIps: getHubLanIps(),
      port: PORT,
      ...getHubFailoverMeta()
    }));
  } catch (e) {
  }
  if (!HUB_REQUIRE_AUTH) {
    try {
      const greeting = {
        type: "HUB_GREETING",
        action: "HUB_INFO",
        hubId: hubSecurityState.hubId,
        tenantId: hubTenantId,
        branchId: hubBranchId,
        hub_id: hubSecurityState.hubId,
        branch_id: hubBranchId,
        branch_name: hubBranchName,
        tenant_id: hubTenantId,
        version: HUB_VERSION,
        hub_runtime: HUB_RUNTIME,
        ota_slot: HUB_OTA_SLOT,
        auth_required: HUB_REQUIRE_AUTH,
        ...getHubFailoverMeta(),
        totalSales: salesStore.length,
        totalInventory: inventoryStore.length,
        lastCloudSyncTimestamp,
        message: `Connected to Saimetric Local Hub (${hubBranchName})`,
        timestamp: Date.now()
      };
      ws.send(JSON.stringify(greeting));
    } catch (e) {
    }
  }
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN && ws.isAuthenticated) {
      if (terminalDeviceId) {
        const lastSeen = terminalLastActivity.get(terminalDeviceId) || 0;
        const gapMs = Date.now() - lastSeen;
        if (lastSeen > 0 && gapMs > 4 * 60 * 60 * 1e3) {
          console.log(`[Termux Hub] \u{1F305} SOD (Start of Day) gap > 4h detected for terminal "${terminalDeviceId}" (${(gapMs / 36e5).toFixed(1)} hrs). Triggering SOD sweep!`);
          triggerClientReconSweep(ws, true);
          return;
        }
      }
      triggerClientReconSweep(ws, false);
    }
  }, 3500);
  ws.on("message", (message) => {
    try {
      ws.lastActivityAt = Date.now();
      const dataStr = message.toString();
      let packet;
      try {
        packet = JSON.parse(dataStr);
      } catch (err) {
        return;
      }
      if (!packet || typeof packet !== "object") return;
      const pType = (packet.type || packet.action || "").toUpperCase();
      const payload = packet.payload || packet.data || packet.item;
      const sheetName = packet.sheetName || packet.sheet;
      const entityType = packet.entityType || packet.entity;
      if (pType === "PING" || pType === "HEARTBEAT") {
        try {
          ws.send(JSON.stringify({ type: "PONG", ts: packet.ts || Date.now() }));
        } catch {
        }
        return;
      }
      if (pType === "PONG") {
        return;
      }
      if (pType === "PAIR_REQUEST") {
        if (isPairRateLimited(remoteIp)) {
          try {
            ws.send(JSON.stringify({
              type: "PAIR_REJECTED",
              reason: "Too many failed pairing attempts. Please wait 60 seconds and try again."
            }));
          } catch {
          }
          return;
        }
        const reqDeviceId = String(packet.deviceId || "").trim();
        const reqDeviceName = String(packet.deviceName || "POS Terminal").trim();
        const reqBranchId = String(packet.branchId || hubBranchId).trim();
        const reqTenantId = String(packet.tenantId || hubTenantId).trim();
        const reqPairCode = String(packet.pairCode || "").replace(/[^0-9A-Za-z]/g, "").trim();
        const reqClientNonce = String(packet.clientNonce || "").trim();
        if (!reqDeviceId) {
          try {
            ws.send(JSON.stringify({ type: "PAIR_REJECTED", reason: "Missing deviceId in PAIR_REQUEST." }));
          } catch {
          }
          return;
        }
        if (reqPairCode) {
          const now = Date.now();
          const hasValidCode = Boolean(hubSecurityState.activePairCode) && hubSecurityState.pairCodeExpiresAt > now && hubConstantTimeEqual(reqPairCode, hubSecurityState.activePairCode);
          if (!hasValidCode) {
            recordPairFailure(remoteIp);
            try {
              ws.send(JSON.stringify({
                type: "PAIR_REJECTED",
                reason: "Invalid or expired 6-digit pairing code. Generate a fresh code on the Hub."
              }));
            } catch {
            }
            return;
          }
          hubSecurityState.activePairCode = null;
          hubSecurityState.pairCodeExpiresAt = 0;
          approveDevicePairing(ws, {
            deviceId: reqDeviceId,
            deviceName: reqDeviceName,
            branchId: reqBranchId,
            tenantId: reqTenantId
          });
          return;
        }
        const confirmCode = computeHubVisualConfirmCode(hubSecurityState.hubId, reqDeviceId, reqClientNonce);
        pendingPairRequests.set(reqDeviceId, {
          ws,
          deviceId: reqDeviceId,
          deviceName: reqDeviceName,
          branchId: reqBranchId,
          tenantId: reqTenantId,
          confirmCode,
          createdAt: Date.now()
        });
        emitHubIpcEvent({
          event: "PAIR_APPROVAL_NEEDED",
          hubId: hubSecurityState.hubId,
          deviceId: reqDeviceId,
          deviceName: reqDeviceName,
          branchId: reqBranchId,
          confirmCode
        });
        ws.hasPendingPair = true;
        console.log(`[Termux Hub] \u{1F510} PAIRING REQUEST from "${reqDeviceName}" (${reqDeviceId}) \u2014 Confirm Code: ${confirmCode}`);
        try {
          ws.send(JSON.stringify({
            type: "PAIR_PENDING",
            action: "PAIR_PENDING",
            hubId: hubSecurityState.hubId,
            hub_id: hubSecurityState.hubId,
            branchId: hubBranchId,
            branchName: hubBranchName,
            confirmCode,
            timestamp: Date.now()
          }));
        } catch {
        }
        return;
      }
      if (pType === "AUTH_RESPONSE") {
        const reqDeviceId = String(packet.deviceId || "").trim();
        const reqNonce = String(packet.nonce || "").trim();
        const reqClientNonce = String(packet.clientNonce || "").trim();
        const reqTs = Number(packet.timestamp || 0);
        const reqClientProof = String(packet.clientProof || "").trim();
        const deviceRec = hubSecurityState.pairedDevices[reqDeviceId];
        if (!deviceRec || deviceRec.revoked) {
          try {
            ws.send(JSON.stringify({
              type: "AUTH_FAILED",
              reason: deviceRec?.revoked ? "This device was revoked on the Local Hub." : "Unrecognized device. Pair this device first."
            }));
            ws.close(4001, "Unauthorized device");
          } catch {
          }
          return;
        }
        if (!ws.authNonce || !hubConstantTimeEqual(reqNonce, ws.authNonce)) {
          try {
            ws.send(JSON.stringify({ type: "AUTH_FAILED", reason: "Invalid or replayed auth nonce." }));
            ws.close(4001, "Invalid nonce");
          } catch {
          }
          return;
        }
        if (!Number.isFinite(reqTs) || Math.abs(Date.now() - reqTs) > 12e4) {
          try {
            ws.send(JSON.stringify({ type: "AUTH_FAILED", reason: "Auth timestamp expired or clock drift exceeds 2 minutes." }));
            ws.close(4001, "Timestamp drift");
          } catch {
          }
          return;
        }
        const expectedClientProof = hubHmacSha256Hex(
          deviceRec.deviceSecret,
          `CLIENT:${reqNonce}:${hubSecurityState.hubId}:${reqDeviceId}:${reqTs}`
        );
        if (!hubConstantTimeEqual(reqClientProof, expectedClientProof)) {
          try {
            ws.send(JSON.stringify({ type: "AUTH_FAILED", reason: "Cryptographic client proof verification failed." }));
            ws.close(4001, "Invalid clientProof");
          } catch {
          }
          return;
        }
        const serverTime = Date.now();
        const hubProof = hubHmacSha256Hex(
          deviceRec.deviceSecret,
          `HUB:${reqClientNonce}:${hubSecurityState.hubId}:${hubBranchId}:${serverTime}`
        );
        ws.isAuthenticated = true;
        ws.pairedDeviceId = reqDeviceId;
        ws.pairedDeviceSecret = deviceRec.deviceSecret;
        ws.authNonce = "";
        deviceRec.lastSeenAt = serverTime;
        saveHubSecurityState();
        try {
          ws.send(JSON.stringify({
            type: "AUTH_OK",
            action: "AUTH_OK",
            hubId: hubSecurityState.hubId,
            hub_id: hubSecurityState.hubId,
            branchId: hubBranchId,
            branch_id: hubBranchId,
            branchName: hubBranchName,
            branch_name: hubBranchName,
            tenantId: hubTenantId,
            tenant_id: hubTenantId,
            version: HUB_VERSION,
            hub_runtime: HUB_RUNTIME,
            ota_slot: HUB_OTA_SLOT,
            mdnsHost: getHubMdnsHost(),
            lanIps: getHubLanIps(),
            port: PORT,
            ...getHubFailoverMeta(),
            serverTime,
            hubProof
          }));
        } catch {
        }
        console.log(`[Termux Hub] \u2705 Mutually authenticated terminal "${deviceRec.deviceName}" (${reqDeviceId})`);
        return;
      }
      if (HUB_REQUIRE_AUTH && !ws.isAuthenticated && pType !== "PING_HUB" && pType !== "PING_IDENTITY") {
        try {
          ws.send(JSON.stringify({
            type: "AUTH_FAILED",
            reason: "Authentication required. Complete mutual handshake or pair this terminal first."
          }));
        } catch {
        }
        return;
      }
      if (pType === "CHECK_HUB_UPDATE") {
        emitHubIpcEvent({
          event: "CHECK_HUB_UPDATE",
          requestedBy: packet.deviceId || ws.pairedDeviceId || "UNKNOWN",
          timestamp: Date.now()
        });
        if (HUB_RUNTIME !== "ANDROID_APK") {
          try {
            ws.send(JSON.stringify({
              type: "HUB_UPDATE_STATUS",
              action: "HUB_UPDATE_STATUS",
              status: "TERMUX_MANUAL",
              message: `Running Termux Backup Hub v${HUB_VERSION}. Signed Cloud OTA applies to the Android Hub APK.`,
              timestamp: Date.now()
            }));
          } catch {
          }
        }
        return;
      }
      if (packet.cloudSyncUrl || packet.cloudUrl) {
        cloudSyncUrl = packet.cloudSyncUrl || packet.cloudUrl;
      }
      const devId = packet.deviceId || packet.origin_device_id || packet.originDeviceId;
      if (devId) {
        terminalDeviceId = devId;
        terminalLastActivity.set(devId, Date.now());
      }
      if (packet.supabaseUrl) supabaseUrl = packet.supabaseUrl;
      if (packet.supabaseKey) supabaseKey = packet.supabaseKey;
      if (packet.cloudConfig) {
        if (packet.cloudConfig.supabaseUrl) supabaseUrl = packet.cloudConfig.supabaseUrl;
        if (packet.cloudConfig.supabaseKey) supabaseKey = packet.cloudConfig.supabaseKey;
      }
      if (pType === "SYNC_CLOUD_CONFIG") {
        if (packet.config && typeof packet.config === "object") {
          cloudConfig = packet.config;
          const creds = cloudConfig.credentials && typeof cloudConfig.credentials === "object" ? cloudConfig.credentials : {};
          const incomingCompanyId = String(cloudConfig.companyId || packet.companyId || packet.company_id || "").trim();
          const incomingTok = String(creds.token || creds.jwt || packet.token || packet.jwt || "").trim();
          const incomingSid = String(creds.spreadsheetId || creds.sheetId || packet.spreadsheet_id || "").trim();
          const incomingGw = String(cloudConfig.gatewayUrl || creds.gatewayUrl || packet.gatewayUrl || "").trim();
          const incomingEpoch = Number(creds.routingEpoch || creds.routing_epoch || packet.routing_epoch || 0);
          if (incomingCompanyId) {
            if (hubTenantId !== incomingCompanyId) {
              lastAppsScriptServerSeq = 0;
              lastCloudSyncTimestamp = 0;
            }
            hubTenantId = incomingCompanyId;
          }
          if (incomingTok) {
            cloudJwtToken = incomingTok;
            cloudBackoffUntil = 0;
          }
          if (incomingSid) cloudSpreadsheetId = incomingSid;
          if (incomingGw) cloudGatewayUrl = incomingGw;
          if (incomingEpoch > 0) cloudRoutingEpoch = Math.max(cloudRoutingEpoch, incomingEpoch);
          if (cloudConfig.runtimePolicy && typeof cloudConfig.runtimePolicy === "object") {
            applyHubRuntimePolicy(cloudConfig.runtimePolicy);
          }
          encryptAndSaveCloudConfig(cloudConfig);
          scheduleSave();
          console.log("[Termux Hub] \u{1F512} Received and encrypted Cloud Config. DB Type:", packet.config.databaseType, "| Tenant:", hubTenantId, cloudGatewayUrl ? "| Unified Gateway: ON" : "");
          try {
            ws.send(JSON.stringify({
              type: "SYNC_CLOUD_CONFIG_ACK",
              action: "SYNC_CLOUD_CONFIG_ACK",
              success: true,
              databaseType: packet.config.databaseType || "unknown",
              companyId: hubTenantId,
              protocolVersion: hubRuntimePolicy.protocolVersion,
              routing_epoch: cloudRoutingEpoch,
              policy: hubRuntimePolicy,
              timestamp: Date.now()
            }));
          } catch (e) {
          }
        }
        return;
      }
      if (pType === "SYNC_SNAPSHOT_RESPONSE") {
        const sweepId = packet.sweepId || `sweep-${Date.now()}`;
        const entity = packet.entityType || packet.snapshot?.entityType;
        const clientSnap = packet.snapshot || packet.payload;
        if (clientSnap && entity) {
          const hubSnap = computeHubSnapshot(entity, clientSnap.startDate, clientSnap.endDate);
          const countMatch = clientSnap.count === hubSnap.count;
          const sumMatch = Math.abs((Number(clientSnap.totalSum) || 0) - (Number(hubSnap.totalSum) || 0)) < 0.01;
          const hashMatch = String(clientSnap.idHash || "").trim() === String(hubSnap.idHash || "").trim();
          if (countMatch && sumMatch && hashMatch) {
            console.log(`[Termux Hub] \u26A1 SNAPSHOT MATCH for "${entity}" (count=${hubSnap.count}, sum=${hubSnap.totalSum}, hash=${hubSnap.idHash})! Terminal and Hub in sync (0 bytes diff).`);
          } else {
            console.log(`[Termux Hub] \u26A0\uFE0F SNAPSHOT MISMATCH for "${entity}"! Client: (count=${clientSnap.count}, sum=${clientSnap.totalSum}, hash=${clientSnap.idHash}) vs Hub: (count=${hubSnap.count}, sum=${hubSnap.totalSum}, hash=${hubSnap.idHash}). Requesting granular ID digest...`);
            const reqPacket = {
              type: "SYNC_ID_DIGEST_REQUEST",
              action: "SYNC_ID_DIGEST_REQUEST",
              sweepId,
              entityType: entity,
              startDate: clientSnap.startDate,
              endDate: clientSnap.endDate,
              hubTimestamp: Date.now(),
              originDeviceId: `HUB-${hubBranchId}`
            };
            try {
              ws.send(JSON.stringify(reqPacket));
            } catch (err) {
              console.warn("[Termux Hub] Failed to send SYNC_ID_DIGEST_REQUEST:", err.message);
            }
          }
        }
        return;
      }
      if (pType === "RECON_PUSH_CHUNK_COMPLETE") {
        try {
          ws.send(JSON.stringify({
            type: "RECON_PUSH_CHUNK_ACK",
            action: "RECON_PUSH_CHUNK_ACK",
            sweepId: packet.sweepId || "",
            entityType: packet.entityType || "",
            chunkIndex: typeof packet.chunkIndex === "number" ? packet.chunkIndex : 0,
            timestamp: Date.now()
          }));
        } catch {
        }
        return;
      }
      if (pType === "SYNC_ID_DIGEST_RESPONSE") {
        const sweepId = packet.sweepId || `sweep-${Date.now()}`;
        const entity = packet.entityType || packet.digest?.entityType;
        const digest = packet.digest || packet.payload;
        console.log(`[Termux Hub] \u{1F4E5} Received SYNC_ID_DIGEST_RESPONSE for entity "${entity}" (${digest?.count || 0} items, sweep: ${sweepId})`);
        if (digest && entity) {
          const missingOrOutdated = computeDigestDiff(digest, entity);
          if (missingOrOutdated.length > 0) {
            console.log(`[Termux Hub] \u{1F50D} computeDigestDiff found ${missingOrOutdated.length} diff record(s) for "${entity}" to push to client`);
            streamReconBackfill(ws, sweepId, entity, missingOrOutdated);
          }
          const clientMissingOnHub = computeClientMissingOnHub(digest, entity);
          if (clientMissingOnHub.length > 0) {
            console.log(`[Termux Hub] \u{1F4E5} Detected ${clientMissingOnHub.length} record(s) for "${entity}" on client missing/newer than Hub. Sending RECON_PUSH_BACKFILL_REQUEST.`);
            try {
              ws.send(JSON.stringify({
                type: "RECON_PUSH_BACKFILL_REQUEST",
                action: "RECON_PUSH_BACKFILL_REQUEST",
                sweepId,
                entityType: entity,
                missingIds: clientMissingOnHub,
                isColdHub: isHubCold(),
                pushChunkSize: 25,
                hubTimestamp: Date.now(),
                originDeviceId: `HUB-${hubBranchId}`
              }));
            } catch (err) {
              console.warn("[Termux Hub] Failed to send RECON_PUSH_BACKFILL_REQUEST:", err.message);
            }
          }
          const clientTombstones = computeClientTombstonedItems(digest, entity);
          if (clientTombstones.length > 0) {
            console.log(`[Termux Hub] \u{1FAA6} Detected ${clientTombstones.length} tombstoned "${entity}" item(s) still on client. Pushing TOMBSTONE_SYNC purge packets!`);
            for (const tomb of clientTombstones) {
              try {
                ws.send(JSON.stringify({
                  type: "TOMBSTONE_SYNC",
                  action: "TOMBSTONE_SYNC",
                  entityType: "tombstone",
                  packet_id: `RECON-TOMB-${tomb.entityType}-${tomb.entityId}-${Date.now()}`,
                  tombstone: tomb,
                  payload: tomb,
                  companyId: tomb.companyId || tomb.company_id || hubTenantId,
                  company_id: tomb.company_id || tomb.companyId || hubTenantId,
                  hubTimestamp: tomb.hubTimestamp || tomb.deletedAt || Date.now(),
                  origin_device_id: "LOCAL_HUB",
                  origin_device_name: "Termux Local Hub",
                  timestamp: Date.now()
                }));
              } catch (err) {
                console.warn("[Termux Hub] Failed to push recon TOMBSTONE_SYNC:", err.message);
              }
            }
          }
          if (missingOrOutdated.length === 0 && clientMissingOnHub.length === 0 && clientTombstones.length === 0) {
            console.log(`[Termux Hub] \u2705 Client and Hub are fully reconciled for "${entity}" (0 diffs)`);
          }
        }
        return;
      }
      if (pType === "SYNC_ID_DIGEST_REQUEST") {
        const sweepId = packet.sweepId || `sweep-${Date.now()}`;
        const entity = packet.entityType;
        console.log(`[Termux Hub] \u{1F4E5} Received SYNC_ID_DIGEST_REQUEST for entity "${entity}" (sweep: ${sweepId})`);
        if (entity) {
          const hubDigest = computeHubDigest(entity, packet.startDate, packet.endDate);
          const responsePacket = {
            type: "SYNC_ID_DIGEST_RESPONSE",
            action: "SYNC_ID_DIGEST_RESPONSE",
            sweepId,
            entityType: entity,
            digest: hubDigest,
            deviceId: `HUB-${hubBranchId}`,
            timestamp: Date.now()
          };
          try {
            ws.send(JSON.stringify(responsePacket));
            console.log(`[Termux Hub] \u{1F4E4} Sent Hub digest for "${entity}" (${hubDigest.count} items) to client`);
          } catch (err) {
            console.warn("[Termux Hub] Failed to send SYNC_ID_DIGEST_RESPONSE:", err.message);
          }
        }
        return;
      }
      if (pType === "RECON_SWEEP_TRIGGER") {
        const sweepId = packet.sweepId || `sweep-${Date.now()}`;
        const targetEntities = Array.isArray(packet.targetEntities) ? packet.targetEntities : ["sales", "customer_changes", "credit_sales", "cash_logs", "stock_movements", "direct_grvs", "expenses", "inventory", "customers", "staff", "branches"];
        console.log(`[Termux Hub] \u{1F9F9} Client requested RECON_SWEEP_TRIGGER for entities: ${targetEntities.join(", ")}`);
        for (const ent of targetEntities) {
          const reqPacket = {
            type: "SYNC_ID_DIGEST_REQUEST",
            sweepId,
            entityType: ent,
            startDate: packet.dateRange?.start,
            endDate: packet.dateRange?.end,
            hubTimestamp: Date.now(),
            originDeviceId: `HUB-${hubBranchId}`
          };
          try {
            ws.send(JSON.stringify(reqPacket));
          } catch (e) {
          }
        }
        return;
      }
      if (pType === "PING_HUB" || pType === "PING_IDENTITY") {
        const hubInfoResponse = {
          type: "HUB_INFO",
          action: "HUB_INFO",
          branch_id: hubBranchId,
          branch_name: hubBranchName,
          tenant_id: hubTenantId,
          hub_id: hubSecurityState.hubId,
          version: HUB_VERSION,
          hub_runtime: HUB_RUNTIME,
          ota_slot: HUB_OTA_SLOT,
          auth_required: HUB_REQUIRE_AUTH,
          routing_epoch: cloudRoutingEpoch,
          totalRecords: salesStore.length + directGrvsStore.length,
          casualWorkersCount: casualWorkersStore.length,
          timestamp: Date.now()
        };
        try {
          ws.send(JSON.stringify(hubInfoResponse));
          console.log(`[Termux Hub] Replied to PING_HUB: Branch ${hubBranchId} ("${hubBranchName}")`);
        } catch (e) {
          console.warn("[Termux Hub] Failed to send HUB_INFO response:", e.message);
        }
        return;
      }
      if (pType === "RESET_BRANCH") {
        if (HUB_REQUIRE_AUTH) {
          const authTs = Number(packet.authTs || 0);
          const authSig = String(packet.authSig || "");
          const recordId = String(packet.packet_id || packet.entityId || packet.recordId || "GLOBAL");
          const validTs = Number.isFinite(authTs) && Math.abs(Date.now() - authTs) <= 6e4;
          const expectedSig = ws.pairedDeviceSecret ? hubHmacSha256Hex(ws.pairedDeviceSecret, `CMD:RESET_BRANCH:${recordId}:${authTs}`) : "";
          if (!ws.isAuthenticated || !validTs || !hubConstantTimeEqual(authSig, expectedSig)) {
            console.warn("[Termux Hub] \u{1F6D1} Blocked unsigned/invalid RESET_BRANCH command.");
            try {
              ws.send(JSON.stringify({
                type: "AUTH_FAILED",
                reason: "RESET_BRANCH requires a valid signed command from an authenticated paired terminal."
              }));
            } catch {
            }
            return;
          }
        }
        console.warn(`[Termux Hub] \u26A0\uFE0F RESET_BRANCH received! Wiping memory and resetting branch identity...`);
        salesStore = [];
        inventoryStore = [];
        directGrvsStore = [];
        cashMovementsStore = [];
        cashLiftsStore = [];
        cashLogsStore = [];
        customerChangesStore = [];
        creditSalesStore = [];
        creditGroupsStore = [];
        stockMovementsStore = [];
        expensesStore = [];
        cashTransfersStore = [];
        internalConsumptionsStore = [];
        casualWorkersStore = [];
        zoneAssignmentsStore = [];
        branchLockdownsStore = {};
        salespeopleStore = [];
        customersStore = [];
        branchesStore = [];
        cashAccountsStore = [];
        businessDayClosuresStore = [];
        electronicSettlementsStore = [];
        permissionsMatrixStore = { rules: [], updatedAt: 0 };
        roleConfigsStore = { definitions: null, updatedAt: 0 };
        multiCurrencyStore = { config: null, updatedAt: 0 };
        genericEntitiesStore = {};
        lastAppsScriptServerSeq = 0;
        hubBranchId = packet.new_branch_id || "UNASSIGNED";
        hubBranchName = packet.new_branch_name || "Unassigned Hub";
        saveData();
        const resetAck = {
          type: "RESET_CONFIRMED",
          action: "RESET_CONFIRMED",
          hub_id: `HUB-${hubBranchId}`,
          branch_id: hubBranchId,
          branch_name: hubBranchName,
          message: "Local Hub has been reset and branch unassigned.",
          timestamp: Date.now()
        };
        try {
          ws.send(JSON.stringify(resetAck));
        } catch (e) {
        }
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify(resetAck));
            } catch (e) {
            }
          }
        });
        return;
      }
      if (pType === "HANDSHAKE" || pType === "SET_BRANCH" || pType === "ASSIGN_BRANCH") {
        const assignedBranchId = packet.branch_id || packet.branchId || packet.target_branch_id;
        const assignedBranchName = packet.branch_name || packet.branchName || assignedBranchId;
        const assignedTenantId = packet.tenant_id || packet.tenantId || packet.company_id || packet.companyId;
        if (assignedBranchId && assignedBranchId !== "UNASSIGNED") {
          hubBranchId = assignedBranchId;
          if (assignedBranchName) hubBranchName = assignedBranchName;
          if (assignedTenantId) hubTenantId = assignedTenantId;
          saveData();
          console.log(`[Termux Hub] \u{1F91D} Handshake accepted: Assigned to Branch ${hubBranchId} ("${hubBranchName}")`);
          const hubInfoResponse = {
            type: "HUB_INFO",
            action: "HUB_INFO",
            branch_id: hubBranchId,
            branch_name: hubBranchName,
            tenant_id: hubTenantId,
            hub_id: `HUB-${hubBranchId}`,
            version: "3.7.0",
            routing_epoch: cloudRoutingEpoch,
            totalRecords: salesStore.length + directGrvsStore.length,
            casualWorkersCount: casualWorkersStore.length,
            timestamp: Date.now()
          };
          try {
            ws.send(JSON.stringify(hubInfoResponse));
          } catch (e) {
            console.warn("[Termux Hub] Failed to send HUB_INFO response after handshake:", e.message);
          }
          return;
        }
      }
      if (pType === "DRAIN_COMPLETE_PING") {
        scheduleSave();
        const drainAck = {
          type: "DRAIN_COMPLETE_ACK",
          action: "DRAIN_COMPLETE_ACK",
          deviceId: packet.deviceId,
          branchId: packet.branchId,
          hubTimestamp: Date.now(),
          timestamp: Date.now()
        };
        try {
          ws.send(JSON.stringify(drainAck));
          console.log(`[Termux Hub] \u{1F504} Received DRAIN_COMPLETE_PING from device [${packet.deviceId}]. Offline queue flushed. Responded with DRAIN_COMPLETE_ACK.`);
        } catch (e) {
        }
        return;
      }
      const packetAction = String(packet.action || "").trim().toUpperCase();
      const rawDelEntityType = packet.entityType || payload?.entityType || sheetName || "";
      const isTombstoneEarly = pType === "TOMBSTONE_SYNC" || pType === "TOMBSTONE" || String(entityType || "").toLowerCase() === "tombstone";
      const isDirectDelete = (packetAction === "DELETE" || pType === "DELETE" || pType === "DB_DELETION") && isHubT2EntityType(rawDelEntityType || pType);
      if (isTombstoneEarly || isDirectDelete) {
        const tombObj = packet.tombstone || payload || packet;
        const resolvedType = normalizeHubEntityType(
          isTombstoneEarly ? tombObj.entityType || packet.entityType : rawDelEntityType || pType
        );
        const resolvedId = String(
          tombObj?.entityId || packet.entityId || packet.recordId || tombObj?.itemId || tombObj?.ItemID || tombObj?.customerId || tombObj?.supplierId || tombObj?.SupplierID || tombObj?.branchId || tombObj?.account_id || tombObj?.categoryId || tombObj?.sessionId || tombObj?.ProductID || tombObj?.id || packet.id || ""
        ).trim();
        if (resolvedId && resolvedType) {
          const stampedTomb = recordAndPurgeHubTombstone(
            resolvedType,
            resolvedId,
            tombObj?.deletedAt || packet.updatedAt || packet.timestamp || Date.now(),
            {
              ...tombObj,
              companyId: tombObj?.companyId || tombObj?.company_id || packet.companyId || hubTenantId,
              company_id: tombObj?.company_id || tombObj?.companyId || packet.company_id || packet.companyId || hubTenantId,
              branchId: tombObj?.branchId || tombObj?.branch_id || packet.branchId || hubBranchId
            }
          );
          scheduleSave();
          console.log(`[Termux Hub] \u{1FAA6} Recorded Tombstone & purged ${resolvedType} #${resolvedId} from Hub T2 stores`);
          try {
            ws.send(JSON.stringify({
              type: "SYNC_ACK",
              action: "SYNC_ACK",
              entityType: "tombstone",
              id: stampedTomb.id,
              entityId: resolvedId,
              recordId: resolvedId,
              targetEntityType: resolvedType,
              updatedAt: stampedTomb.deletedAt,
              hubTimestamp: stampedTomb.hubTimestamp
            }));
          } catch (e) {
          }
          const tombcast = JSON.stringify({
            type: "TOMBSTONE_SYNC",
            action: "TOMBSTONE_SYNC",
            entityType: "tombstone",
            packet_id: `TOMB-CAST-${stampedTomb.id}-${Date.now()}`,
            tombstone: stampedTomb,
            payload: stampedTomb,
            companyId: stampedTomb.companyId || stampedTomb.company_id || hubTenantId,
            company_id: stampedTomb.company_id || stampedTomb.companyId || hubTenantId,
            hubTimestamp: stampedTomb.hubTimestamp,
            origin_device_id: packet.origin_device_id || packet.originDeviceId || "LOCAL_HUB",
            origin_device_name: packet.origin_device_name || packet.originDeviceName || "Termux Local Hub",
            timestamp: Date.now()
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(tombcast);
              } catch (e) {
              }
            }
          });
          return;
        }
      }
      if (pType === "CASUAL_WORKERS_SYNC") {
        const incoming = packet.casualWorkers || payload || packet.casuals;
        const hubNow = Date.now();
        const hubIso = (/* @__PURE__ */ new Date()).toISOString();
        if (Array.isArray(incoming)) {
          for (const cw of incoming) {
            if (!cw) continue;
            const cleanCw = { ...cw };
            delete cleanCw.pin;
            const cwId = cleanCw.id || cleanCw.pin_hash;
            const incomingTime = getTimestamp(cleanCw) || getTimestamp(packet);
            if (cwId && isTombstoned(cwId, "casual_worker", incomingTime)) {
              console.log(`[Termux Hub] \u{1FAA6} Resurrection Blocked for tombstoned casual worker #${cwId}`);
              continue;
            }
            const exIdx = casualWorkersStore.findIndex((c) => cw.id && c.id === cw.id || cw.pin_hash && c.pin_hash === cw.pin_hash);
            if (exIdx >= 0) {
              const existing = casualWorkersStore[exIdx];
              const existingTime = getTimestamp(existing);
              if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
                console.log(
                  `[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale casual worker update for ${cwId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
                );
                try {
                  ws.send(JSON.stringify({
                    type: "CASUAL_WORKERS_SYNC",
                    action: "CASUAL_WORKERS_SYNC",
                    casualWorkers: [existing],
                    payload: [existing],
                    updatedAt: existingTime,
                    hubTimestamp: existingTime,
                    lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                    origin_device_id: "LOCAL_HUB",
                    origin_device_name: "Termux Local Hub",
                    timestamp: Date.now()
                  }));
                } catch (e) {
                }
                continue;
              }
            }
            const stamped = {
              ...cleanCw,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso
            };
            if (exIdx >= 0) {
              casualWorkersStore[exIdx] = { ...casualWorkersStore[exIdx], ...stamped };
            } else {
              casualWorkersStore.push(stamped);
            }
          }
          scheduleSave();
          try {
            ws.send(JSON.stringify({
              type: "SYNC_ACK",
              action: "SYNC_ACK",
              entityType: "CASUAL_WORKERS",
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso
            }));
          } catch (e) {
          }
        }
        const sanitizedPacket = {
          type: "CASUAL_WORKERS_SYNC",
          action: "CASUAL_WORKERS_SYNC",
          casualWorkers: casualWorkersStore,
          payload: casualWorkersStore,
          branchId: packet.branchId || hubBranchId,
          timestamp: hubNow,
          updatedAt: hubNow
        };
        const forwardStr = JSON.stringify(sanitizedPacket);
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(forwardStr);
            } catch (e) {
            }
          }
        });
        return;
      }
      const ACTIVE_FLOOR_STATUSES_SET = /* @__PURE__ */ new Set([
        "ACTIVE",
        "IN_PROGRESS",
        "COUNTING",
        "PAUSED",
        "RECOUNT",
        "RECOUNTING",
        "AUDIT_REVIEW",
        "CONSOLIDATED",
        "PENDING_SIGNOFF",
        "READY_FOR_COMMITTAL"
      ]);
      if (pType === "STOCKTAKE_LOCKDOWN_BROADCAST") {
        const brId = packet.branchId || packet.branch_id || hubBranchId;
        const canonHubLockBr = (b) => {
          const u = String(b || "").trim().toUpperCase();
          if (u === "1" || u === "BR001" || u === "BR-001" || u === "BR-MAIN" || u === "HQ-01" || u === "MAIN") return "BR-MAIN";
          return u;
        };
        const brCanon = canonHubLockBr(brId);
        const hubNow = Date.now();
        const hubIso = new Date(hubNow).toISOString();
        const incomingTime = getTimestamp(packet) || hubNow;
        const existingLock = branchLockdownsStore[brId] || Object.entries(branchLockdownsStore || {}).find(
          ([k, st]) => st && (canonHubLockBr(k) === brCanon || canonHubLockBr(st.branchId) === brCanon)
        )?.[1];
        const existingTime = existingLock ? getTimestamp(existingLock) : 0;
        const activeSessionForBranch = stocktakeSessionsStore.find((s) => {
          if (!s || !s.sessionId) return false;
          if (isTombstoned(s.sessionId, "stocktake_session", getTimestamp(s))) return false;
          const sBranch = canonHubLockBr(s.branchId || hubBranchId || "");
          const sStatus = String(s.status || "").toUpperCase();
          return (!brCanon || !sBranch || sBranch === brCanon) && ACTIVE_FLOOR_STATUSES_SET.has(sStatus);
        });
        const incomingSessId = String(packet.sessionId || "").trim().toUpperCase();
        const activeSessId = activeSessionForBranch ? String(activeSessionForBranch.sessionId || "").trim().toUpperCase() : "";
        const existingLockSessId = existingLock && existingLock.sessionId ? String(existingLock.sessionId).trim().toUpperCase() : "";
        if (packet.isLocked && activeSessId && incomingSessId && incomingSessId !== activeSessId) {
          console.log(
            `[Termux Hub] \u{1F6E1}\uFE0F Lockdown Session Guard: Rejected lockdown packet for ${brId} from non-active session [${incomingSessId}] while [${activeSessId}] is active.`
          );
          if (existingLock) {
            try {
              ws.send(JSON.stringify({
                type: "STOCKTAKE_LOCKDOWN_BROADCAST",
                action: "STOCKTAKE_LOCKDOWN_BROADCAST",
                ...existingLock,
                origin_device_id: "LOCAL_HUB",
                timestamp: hubNow
              }));
            } catch (e) {
            }
          }
          return;
        }
        if (existingLock && existingLock.isLocked && existingLockSessId && !packet.isLocked && incomingSessId && incomingSessId !== existingLockSessId) {
          const existingOwnerSess = stocktakeSessionsStore.find(
            (s) => s && String(s.sessionId || "").trim().toUpperCase() === existingLockSessId
          );
          const ownerIsStillActive = Boolean(
            existingOwnerSess && ACTIVE_FLOOR_STATUSES_SET.has(String(existingOwnerSess.status || "").toUpperCase())
          );
          if (ownerIsStillActive) {
            console.log(
              `[Termux Hub] \u{1F6E1}\uFE0F Lockdown Unlock Guard: Rejected unlock for ${brId} from mismatched session [${incomingSessId}] (owned by [${existingLockSessId}]).`
            );
            try {
              ws.send(JSON.stringify({
                type: "STOCKTAKE_LOCKDOWN_BROADCAST",
                action: "STOCKTAKE_LOCKDOWN_BROADCAST",
                ...existingLock,
                origin_device_id: "LOCAL_HUB",
                timestamp: hubNow
              }));
            } catch (e) {
            }
            return;
          }
        }
        const isAuthoritativeUnlock = !packet.isLocked && (!existingLock?.isLocked || !existingLockSessId || !incomingSessId || incomingSessId === existingLockSessId || !activeSessId);
        if (!isAuthoritativeUnlock && existingLock && existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
          console.log(`[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale STOCKTAKE_LOCKDOWN_BROADCAST for ${brId}`);
          return;
        }
        for (const k of Object.keys(branchLockdownsStore || {})) {
          if (canonHubLockBr(k) === brCanon || canonHubLockBr(branchLockdownsStore[k]?.branchId) === brCanon) {
            delete branchLockdownsStore[k];
          }
        }
        const effectiveUpdatedAt = Math.max(incomingTime, isAuthoritativeUnlock && existingTime > 0 ? existingTime + 1 : 0, hubNow);
        branchLockdownsStore[brId] = {
          branchId: brId,
          companyId: packet.companyId || packet.company_id || hubTenantId,
          company_id: packet.company_id || packet.companyId || hubTenantId,
          isLocked: Boolean(packet.isLocked),
          sessionId: packet.sessionId || existingLock?.sessionId,
          lockedAt: packet.isLocked ? packet.lockedAt || hubIso : void 0,
          lockedBy: packet.lockedBy,
          lockedByName: packet.lockedByName,
          reason: packet.reason,
          updatedAt: effectiveUpdatedAt,
          lastUpdated: packet.lastUpdated || new Date(effectiveUpdatedAt).toISOString(),
          isCloudSynced: false
        };
        scheduleSave();
        console.log(`[Termux Hub] \u{1F512} Branch Lockdown status changed: ${brId} isLocked=${packet.isLocked} session=${packet.sessionId || "N/A"}`);
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(dataStr);
            } catch (e) {
            }
          }
        });
        return;
      }
      const isStocktakeSession = pType === "STOCKTAKE_SESSION_STARTED" || pType === "STOCKTAKE_SESSION_SYNC" || pType === "STOCKTAKE_SESSION";
      if (isStocktakeSession) {
        const sess = packet.session || payload || packet;
        const sessionId = packet.sessionId || sess.sessionId;
        if (sessionId) {
          const hubNow = Date.now();
          const hubIso = new Date(hubNow).toISOString();
          const incomingTime = getTimestamp(sess) || getTimestamp(packet);
          if (isTombstoned(sessionId, "stocktake_session", incomingTime)) {
            console.log(`[Termux Hub] \u{1FAA6} Resurrection Blocked for tombstoned stocktake session #${sessionId}`);
            return;
          }
          const sIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
          const existing = sIdx >= 0 ? stocktakeSessionsStore[sIdx] : null;
          const targetBranchNorm = String(packet.branchId || sess.branchId || existing?.branchId || hubBranchId || "").trim().toUpperCase();
          const incomingStatusNorm = String(packet.status || sess.status || existing?.status || "DRAFT").toUpperCase();
          if (ACTIVE_FLOOR_STATUSES_SET.has(incomingStatusNorm)) {
            const conflictingActive = stocktakeSessionsStore.find((s) => {
              if (!s || s.sessionId === sessionId) return false;
              if (isTombstoned(s.sessionId, "stocktake_session", getTimestamp(s))) return false;
              const sBranch = String(s.branchId || hubBranchId || "").trim().toUpperCase();
              const sStatus = String(s.status || "").toUpperCase();
              return (!targetBranchNorm || !sBranch || sBranch === targetBranchNorm) && ACTIVE_FLOOR_STATUSES_SET.has(sStatus);
            });
            if (conflictingActive) {
              const conflictBranchKey = conflictingActive.branchId || targetBranchNorm || hubBranchId;
              const existingLockdown = branchLockdownsStore[conflictBranchKey] || branchLockdownsStore[String(conflictBranchKey || "").toUpperCase()] || Object.values(branchLockdownsStore || {}).find(
                (lk) => lk && String(lk.sessionId || "").trim().toUpperCase() === String(conflictingActive.sessionId || "").trim().toUpperCase()
              ) || null;
              console.log(
                `[Termux Hub] \u26A0\uFE0F Rejected duplicate active stocktake [${sessionId}] (${incomingStatusNorm}) on branch ${targetBranchNorm}: [${conflictingActive.sessionId}] is already ${conflictingActive.status}.`
              );
              try {
                ws.send(JSON.stringify({
                  type: "STOCKTAKE_SESSION_CONFLICT",
                  sessionId,
                  existingSessionId: conflictingActive.sessionId,
                  existingSessionName: conflictingActive.title || conflictingActive.sessionName || conflictingActive.sessionId,
                  existingSession: conflictingActive,
                  existingLockdown,
                  message: `Only 1 active floor stocktake session is allowed per branch. Close, commit, or archive "${conflictingActive.title || conflictingActive.sessionName}" first.`,
                  timestamp: hubNow
                }));
              } catch (e) {
              }
              return;
            }
          }
          if (existing) {
            const existingTime = getTimestamp(existing);
            if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
              console.log(
                `[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale stocktake session update for ${sessionId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
              );
              try {
                ws.send(JSON.stringify({
                  type: "STOCKTAKE_SESSION_STARTED",
                  action: "STOCKTAKE_SESSION_STARTED",
                  sessionId: existing.sessionId,
                  session: existing,
                  payload: existing,
                  updatedAt: existingTime,
                  hubTimestamp: existingTime,
                  lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                  origin_device_id: "LOCAL_HUB",
                  origin_device_name: "Termux Local Hub",
                  timestamp: Date.now()
                }));
              } catch (e) {
              }
              return;
            }
          }
          const incomingItems = Array.isArray(packet.consolidatedItems) ? packet.consolidatedItems : Array.isArray(sess.consolidatedItems) ? sess.consolidatedItems : void 0;
          let mergedConsolidated = existing?.consolidatedItems || [];
          if (Array.isArray(incomingItems) && incomingItems.length > 0) {
            const exItemMap = /* @__PURE__ */ new Map();
            (existing?.consolidatedItems || []).forEach((ci) => {
              if (ci && ci.itemId) exItemMap.set(String(ci.itemId).toUpperCase(), ci);
            });
            mergedConsolidated = incomingItems.map((inc) => {
              const ex = exItemMap.get(String(inc.itemId || "").toUpperCase());
              if (!ex) return inc;
              const exCT = ex.commentedAt ? new Date(ex.commentedAt).getTime() : 0;
              const incCT = inc.commentedAt ? new Date(inc.commentedAt).getTime() : 0;
              const keepEx = exCT > incCT && Boolean(ex.managerComment || ex.reasonCode);
              const commentMap = /* @__PURE__ */ new Map();
              (Array.isArray(ex.varianceComments) ? ex.varianceComments : []).forEach((c) => {
                if (c && c.id) commentMap.set(c.id, c);
              });
              (Array.isArray(inc.varianceComments) ? inc.varianceComments : []).forEach((c) => {
                if (c && c.id) commentMap.set(c.id, c);
              });
              const mergedComments = Array.from(commentMap.values()).sort(
                (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
              );
              return {
                ...ex,
                ...inc,
                originalCountedCases: ex.originalCountedCases ?? inc.originalCountedCases,
                originalCountedSingles: ex.originalCountedSingles ?? inc.originalCountedSingles,
                originalCountedTotalUnits: ex.originalCountedTotalUnits ?? inc.originalCountedTotalUnits,
                originalVarianceUnits: ex.originalVarianceUnits ?? inc.originalVarianceUnits,
                originalVarianceCostValue: ex.originalVarianceCostValue ?? inc.originalVarianceCostValue,
                originalVarianceRetailValue: ex.originalVarianceRetailValue ?? inc.originalVarianceRetailValue,
                varianceComments: mergedComments.length > 0 ? mergedComments : inc.varianceComments ?? ex.varianceComments,
                reasonCode: keepEx ? ex.reasonCode : inc.reasonCode ?? ex.reasonCode,
                managerComment: keepEx ? ex.managerComment : inc.managerComment ?? ex.managerComment,
                actionTaken: keepEx ? ex.actionTaken : inc.actionTaken ?? ex.actionTaken,
                commentedById: keepEx ? ex.commentedById : inc.commentedById ?? ex.commentedById,
                commentedByName: keepEx ? ex.commentedByName : inc.commentedByName ?? ex.commentedByName,
                commentedAt: keepEx ? ex.commentedAt : inc.commentedAt ?? ex.commentedAt,
                ownerAckStatus: inc.ownerAckStatus ?? ex.ownerAckStatus
              };
            });
          }
          const incomingSegmentsRaw = Array.isArray(packet.segments) ? packet.segments : Array.isArray(sess.segments) ? sess.segments : existing?.segments || [];
          const exSegMap = /* @__PURE__ */ new Map();
          (existing?.segments || []).forEach((es) => {
            const k = es.segmentId || es.id;
            if (k) exSegMap.set(k, es);
          });
          const mergedSegments = incomingSegmentsRaw.map((sg) => {
            const k = sg.segmentId || sg.id;
            const exSeg = k ? exSegMap.get(k) : null;
            if (!exSeg) return sg;
            const uHistMap = /* @__PURE__ */ new Map();
            (Array.isArray(exSeg.unlockHistory) ? exSeg.unlockHistory : []).forEach((u) => {
              uHistMap.set(`${u.unlockedAt || ""}:${u.target || ""}:${u.actorId || ""}`, u);
            });
            (Array.isArray(sg.unlockHistory) ? sg.unlockHistory : []).forEach((u) => {
              uHistMap.set(`${u.unlockedAt || ""}:${u.target || ""}:${u.actorId || ""}`, u);
            });
            const mergedUnlockHistory = Array.from(uHistMap.values());
            return {
              ...exSeg,
              ...sg,
              count1Finalized: sg.count1Finalized !== void 0 ? sg.count1Finalized : exSeg.count1Finalized,
              count2Finalized: sg.count2Finalized !== void 0 ? sg.count2Finalized : exSeg.count2Finalized,
              comparisonFinalized: sg.comparisonFinalized !== void 0 ? sg.comparisonFinalized : exSeg.comparisonFinalized,
              count1FinalizedAt: sg.count1FinalizedAt || exSeg.count1FinalizedAt,
              count2FinalizedAt: sg.count2FinalizedAt || exSeg.count2FinalizedAt,
              comparisonFinalizedAt: sg.comparisonFinalizedAt || exSeg.comparisonFinalizedAt,
              comparisonFinalizedBy: sg.comparisonFinalizedBy || exSeg.comparisonFinalizedBy,
              unlockHistory: mergedUnlockHistory.length > 0 ? mergedUnlockHistory : void 0
            };
          });
          const incomingPasses = Array.isArray(packet.guestPasses) ? packet.guestPasses : Array.isArray(sess.guestPasses) ? sess.guestPasses : void 0;
          const resolvedLockdown = packet.isLockdownActive !== void 0 ? Boolean(packet.isLockdownActive) : sess.isLockdownActive !== void 0 ? Boolean(sess.isLockdownActive) : Boolean(existing?.isLockdownActive);
          const mergedPauseHistory = (() => {
            const exHist = Array.isArray(existing?.pauseHistory) ? existing.pauseHistory : [];
            const incHist = Array.isArray(packet.pauseHistory) ? packet.pauseHistory : Array.isArray(sess.pauseHistory) ? sess.pauseHistory : [];
            const map = /* @__PURE__ */ new Map();
            [...exHist, ...incHist].forEach((entry) => {
              if (!entry || !entry.pausedAt) return;
              const prev = map.get(entry.pausedAt);
              map.set(entry.pausedAt, prev ? { ...prev, ...entry } : entry);
            });
            const merged = Array.from(map.values()).sort(
              (a, b) => new Date(a.pausedAt).getTime() - new Date(b.pausedAt).getTime()
            );
            return merged.length > 0 ? merged : void 0;
          })();
          const resolvedLockdownRequested = packet.lockdownRequested !== void 0 ? Boolean(packet.lockdownRequested) : sess.lockdownRequested !== void 0 ? Boolean(sess.lockdownRequested) : existing?.lockdownRequested;
          const resolvedEverActivated = Boolean(packet.everActivated || sess.everActivated || existing?.everActivated || ACTIVE_FLOOR_STATUSES_SET.has(incomingStatusNorm) || incomingStatusNorm === "APPROVED_POSTED");
          const sessionObj = {
            ...existing || {},
            ...sess,
            sessionId,
            title: packet.sessionName || packet.title || sess.title || existing?.title || `Session ${sessionId}`,
            sessionName: packet.sessionName || packet.title || sess.title || existing?.sessionName || `Session ${sessionId}`,
            date: packet.date || sess.date || existing?.date || hubIso.split("T")[0],
            status: packet.status || sess.status || existing?.status || "DRAFT",
            segments: mergedSegments,
            consolidatedItems: mergedConsolidated,
            guestPasses: incomingPasses !== void 0 ? incomingPasses : existing?.guestPasses,
            startedBy: packet.startedBy || sess.startedBy || existing?.startedBy || "Manager",
            startedAt: packet.startedAt || sess.startedAt || existing?.startedAt || hubIso,
            createdBy: packet.createdBy || sess.createdBy || existing?.createdBy || packet.startedBy || "MANAGER",
            createdByName: packet.createdByName || sess.createdByName || existing?.createdByName || packet.startedBy || "Manager",
            countType: packet.countType || sess.countType || existing?.countType || "DAILY_BLIND",
            branchId: packet.branchId || sess.branchId || existing?.branchId || hubBranchId,
            branchName: packet.branchName || sess.branchName || existing?.branchName || hubBranchName,
            companyId: packet.companyId || sess.companyId || existing?.companyId || hubTenantId,
            company_id: packet.company_id || sess.company_id || existing?.company_id || hubTenantId,
            isLockdownActive: resolvedLockdown,
            lockdownRequested: resolvedLockdownRequested,
            everActivated: resolvedEverActivated,
            activatedAt: packet.activatedAt || sess.activatedAt || existing?.activatedAt,
            activatedBy: packet.activatedBy || sess.activatedBy || existing?.activatedBy,
            activatedByName: packet.activatedByName || sess.activatedByName || existing?.activatedByName,
            pausedAt: packet.pausedAt !== void 0 ? packet.pausedAt : sess.pausedAt !== void 0 ? sess.pausedAt : existing?.pausedAt,
            pausedBy: packet.pausedBy !== void 0 ? packet.pausedBy : sess.pausedBy !== void 0 ? sess.pausedBy : existing?.pausedBy,
            pausedByName: packet.pausedByName !== void 0 ? packet.pausedByName : sess.pausedByName !== void 0 ? sess.pausedByName : existing?.pausedByName,
            pauseReason: packet.pauseReason !== void 0 ? packet.pauseReason : sess.pauseReason !== void 0 ? sess.pauseReason : existing?.pauseReason,
            pausedFromStatus: packet.pausedFromStatus !== void 0 ? packet.pausedFromStatus : sess.pausedFromStatus !== void 0 ? sess.pausedFromStatus : existing?.pausedFromStatus,
            pauseHistory: mergedPauseHistory,
            archivedAt: packet.archivedAt !== void 0 ? packet.archivedAt : sess.archivedAt !== void 0 ? sess.archivedAt : existing?.archivedAt,
            archivedBy: packet.archivedBy !== void 0 ? packet.archivedBy : sess.archivedBy !== void 0 ? sess.archivedBy : existing?.archivedBy,
            archivedByName: packet.archivedByName !== void 0 ? packet.archivedByName : sess.archivedByName !== void 0 ? sess.archivedByName : existing?.archivedByName,
            archiveReason: packet.archiveReason !== void 0 ? packet.archiveReason : sess.archiveReason !== void 0 ? sess.archiveReason : existing?.archiveReason,
            stocktakeAuditorId: packet.stocktakeAuditorId !== void 0 ? packet.stocktakeAuditorId : sess.stocktakeAuditorId !== void 0 ? sess.stocktakeAuditorId : existing?.stocktakeAuditorId,
            stocktakeAuditorName: packet.stocktakeAuditorName !== void 0 ? packet.stocktakeAuditorName : sess.stocktakeAuditorName !== void 0 ? sess.stocktakeAuditorName : existing?.stocktakeAuditorName,
            stocktakeAuditorPhone: packet.stocktakeAuditorPhone !== void 0 ? packet.stocktakeAuditorPhone : sess.stocktakeAuditorPhone !== void 0 ? sess.stocktakeAuditorPhone : existing?.stocktakeAuditorPhone,
            auditorType: packet.auditorType || sess.auditorType || existing?.auditorType,
            auditorGuestPassId: packet.auditorGuestPassId || sess.auditorGuestPassId || existing?.auditorGuestPassId,
            auditorCasualId: packet.auditorCasualId || sess.auditorCasualId || existing?.auditorCasualId,
            predefinedDailyItemIds: packet.predefinedDailyItemIds || sess.predefinedDailyItemIds || existing?.predefinedDailyItemIds,
            certifiedById: packet.certifiedById || sess.certifiedById || existing?.certifiedById,
            certifiedByName: packet.certifiedByName || sess.certifiedByName || existing?.certifiedByName,
            certifiedAt: packet.certifiedAt || sess.certifiedAt || existing?.certifiedAt,
            approvedBy: packet.approvedBy || sess.approvedBy || existing?.approvedBy,
            approvedByName: packet.approvedByName || sess.approvedByName || existing?.approvedByName,
            approvedAt: packet.approvedAt || sess.approvedAt || existing?.approvedAt,
            varianceReviewStatus: packet.varianceReviewStatus || sess.varianceReviewStatus || existing?.varianceReviewStatus,
            varianceCommentDeadline: packet.varianceCommentDeadline || sess.varianceCommentDeadline || existing?.varianceCommentDeadline,
            varianceMaterialityThreshold: packet.varianceMaterialityThreshold !== void 0 ? packet.varianceMaterialityThreshold : sess.varianceMaterialityThreshold !== void 0 ? sess.varianceMaterialityThreshold : existing?.varianceMaterialityThreshold,
            varianceMinUnitThreshold: packet.varianceMinUnitThreshold !== void 0 ? packet.varianceMinUnitThreshold : sess.varianceMinUnitThreshold !== void 0 ? sess.varianceMinUnitThreshold : existing?.varianceMinUnitThreshold,
            varianceReviewWindowHours: packet.varianceReviewWindowHours !== void 0 ? packet.varianceReviewWindowHours : sess.varianceReviewWindowHours !== void 0 ? sess.varianceReviewWindowHours : existing?.varianceReviewWindowHours,
            varianceReviewedById: packet.varianceReviewedById || sess.varianceReviewedById || existing?.varianceReviewedById,
            varianceReviewedByName: packet.varianceReviewedByName || sess.varianceReviewedByName || existing?.varianceReviewedByName,
            varianceReviewedAt: packet.varianceReviewedAt || sess.varianceReviewedAt || existing?.varianceReviewedAt,
            totalSystemUnits: packet.totalSystemUnits !== void 0 ? packet.totalSystemUnits : sess.totalSystemUnits !== void 0 ? sess.totalSystemUnits : existing?.totalSystemUnits || 0,
            totalCountedUnits: packet.totalCountedUnits !== void 0 ? packet.totalCountedUnits : sess.totalCountedUnits !== void 0 ? sess.totalCountedUnits : existing?.totalCountedUnits || 0,
            varianceUnits: packet.varianceUnits !== void 0 ? packet.varianceUnits : sess.varianceUnits !== void 0 ? sess.varianceUnits : existing?.varianceUnits || 0,
            varianceCostValue: packet.varianceCostValue !== void 0 ? packet.varianceCostValue : sess.varianceCostValue !== void 0 ? sess.varianceCostValue : existing?.varianceCostValue || 0,
            varianceRetailValue: packet.varianceRetailValue !== void 0 ? packet.varianceRetailValue : sess.varianceRetailValue !== void 0 ? sess.varianceRetailValue : existing?.varianceRetailValue || 0,
            notes: packet.notes !== void 0 ? packet.notes : sess.notes !== void 0 ? sess.notes : existing?.notes || "",
            version: Math.max(Number(packet.version || sess.version || 0), Number(existing?.version || 0), 1),
            mutationSource: packet.mutationSource || sess.mutationSource || existing?.mutationSource || "USER_EDIT",
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            // CRITICAL: Always mark client-originated stocktake updates dirty so Cloud push_envelopes syncs every revision
            isCloudSynced: false
          };
          if (sIdx >= 0) {
            stocktakeSessionsStore[sIdx] = sessionObj;
          } else {
            stocktakeSessionsStore.unshift(sessionObj);
          }
          const isClosedSessionStatus = sessionObj.status === "APPROVED_POSTED" || sessionObj.status === "ARCHIVED" || sessionObj.status === "CANCELLED";
          if (isClosedSessionStatus) {
            casualWorkersStore.forEach((cw) => {
              if (cw && cw.sessionId === sessionId && cw.active) {
                cw.active = false;
                cw.updatedAt = hubNow;
                cw.lastUpdated = hubIso;
                cw.isCloudSynced = false;
              }
            });
          }
          if ((isClosedSessionStatus || sessionObj.isLockdownActive === false) && branchLockdownsStore && typeof branchLockdownsStore === "object") {
            const cleanSessUpper = String(sessionId || "").trim().toUpperCase();
            const sessBrCanon = String(sessionObj.branchId || hubBranchId || "").trim().toUpperCase();
            for (const brK of Object.keys(branchLockdownsStore)) {
              const lk = branchLockdownsStore[brK];
              if (!lk || !lk.isLocked) continue;
              const lkSessUpper = String(lk.sessionId || "").trim().toUpperCase();
              const lkBrUpper = String(lk.branchId || brK || "").trim().toUpperCase();
              if (lkSessUpper === cleanSessUpper || !lkSessUpper && lkBrUpper === sessBrCanon) {
                const releasedLock = {
                  ...lk,
                  branchId: lk.branchId || sessionObj.branchId || brK,
                  isLocked: false,
                  lockedAt: void 0,
                  sessionId,
                  reason: isClosedSessionStatus ? `Auto-released: stocktake ${sessionId} is ${sessionObj.status}` : `Lockdown disengaged for stocktake ${sessionId}`,
                  updatedAt: Math.max(hubNow, getTimestamp(lk) + 1),
                  lastUpdated: hubIso,
                  isCloudSynced: false
                };
                branchLockdownsStore[brK] = releasedLock;
                const unlockBroadcastStr = JSON.stringify({
                  type: "STOCKTAKE_LOCKDOWN_BROADCAST",
                  action: "STOCKTAKE_LOCKDOWN_BROADCAST",
                  ...releasedLock,
                  origin_device_id: "LOCAL_HUB",
                  timestamp: hubNow
                });
                wss.clients.forEach((client) => {
                  if (client.readyState === WebSocket.OPEN) {
                    try {
                      client.send(unlockBroadcastStr);
                    } catch (e) {
                    }
                  }
                });
              }
            }
          }
          if (Array.isArray(sessionObj.segments) && sessionObj.segments.length > 0) {
            sessionObj.segments.forEach((seg) => {
              const segId = seg.segmentId || seg.id;
              const exSegIdx = stocktakeSegmentsStore.findIndex(
                (s) => s.sessionId === sessionId && (s.segmentId === segId || s.id === segId)
              );
              const segObj = { ...seg, sessionId, segmentId: segId };
              if (exSegIdx >= 0) {
                stocktakeSegmentsStore[exSegIdx] = { ...stocktakeSegmentsStore[exSegIdx], ...segObj };
              } else {
                stocktakeSegmentsStore.push(segObj);
              }
            });
          }
          scheduleSave();
          console.log(
            `[Termux Hub] \u{1F4CB} Synced Stocktake Session [${sessionId}] "${sessionObj.sessionName}" (${sessionObj.status}) with ${(sessionObj.segments || []).length} segments stamped at ${hubIso}.`
          );
          try {
            ws.send(JSON.stringify({
              type: "SYNC_ACK",
              action: "SYNC_ACK",
              entityType: "STOCKTAKE_SESSION",
              id: sessionId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso
            }));
          } catch (e) {
          }
          const sessBroadcastStr = JSON.stringify({
            type: "STOCKTAKE_SESSION_STARTED",
            action: "STOCKTAKE_SESSION_STARTED",
            sessionId,
            branchId: sessionObj.branchId || hubBranchId,
            companyId: sessionObj.companyId || hubTenantId,
            company_id: sessionObj.companyId || hubTenantId,
            session: sessionObj,
            payload: sessionObj,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            origin_device_id: packet.origin_device_id || "LOCAL_HUB",
            timestamp: hubNow
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(sessBroadcastStr);
              } catch (e) {
              }
            }
          });
        }
        return;
      }
      if (pType === "STOCKTAKE_SEGMENT_CREATED") {
        const seg = packet.segment || packet;
        const sessionId = packet.sessionId || seg.sessionId;
        const segId = seg.segmentId || seg.id;
        if (segId) {
          const segObj = { ...seg, sessionId, segmentId: segId };
          const exSegIdx = stocktakeSegmentsStore.findIndex(
            (s) => (s.sessionId === sessionId || !sessionId) && (s.segmentId === segId || s.id === segId)
          );
          if (exSegIdx >= 0) {
            stocktakeSegmentsStore[exSegIdx] = { ...stocktakeSegmentsStore[exSegIdx], ...segObj };
          } else {
            stocktakeSegmentsStore.push(segObj);
          }
          if (sessionId) {
            const sIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
            if (sIdx >= 0) {
              const currentSess = stocktakeSessionsStore[sIdx];
              const segList = Array.isArray(currentSess.segments) ? [...currentSess.segments] : [];
              const exIdx = segList.findIndex((s) => s.segmentId === segId || s.id === segId);
              if (exIdx >= 0) {
                segList[exIdx] = { ...segList[exIdx], ...segObj };
              } else {
                segList.push(segObj);
              }
              currentSess.segments = segList;
              stocktakeSessionsStore[sIdx] = currentSess;
            }
            const exZone = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === segId);
            if (!exZone) {
              zoneAssignmentsStore.push({
                zoneId: segId,
                zoneName: segObj.name || segObj.title || segId,
                sessionId,
                branchId: hubBranchId,
                status: "AVAILABLE"
              });
            }
          }
          scheduleSave();
          console.log(
            `[Termux Hub] \u{1F4CB} STOCKTAKE_SEGMENT_CREATED broadcast: Segment [${segId}] in Session [${sessionId || "N/A"}]. Saved to disk & broadcasted to peers.`
          );
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(dataStr);
              } catch (e) {
              }
            }
          });
        }
        return;
      }
      if (pType === "STOCKTAKE_SESSION_LIST_REQUEST") {
        try {
          const liveSessions = stocktakeSessionsStore.filter(
            (s) => s && s.sessionId && !isTombstoned(s.sessionId, "stocktake_session", getTimestamp(s))
          );
          const sessionTombstones = tombstonesStore.filter(
            (t) => t && normalizeHubEntityType(t.entityType) === "stocktake_session"
          );
          ws.send(
            JSON.stringify({
              type: "STOCKTAKE_SESSION_LIST",
              action: "STOCKTAKE_SESSION_LIST",
              sessions: liveSessions,
              segments: stocktakeSegmentsStore,
              zoneAssignments: zoneAssignmentsStore,
              tombstones: sessionTombstones,
              branchLockdowns: branchLockdownsStore || {},
              timestamp: Date.now()
            })
          );
          console.log(
            `[Termux Hub] \u{1F4CB} Replied to STOCKTAKE_SESSION_LIST_REQUEST with ${liveSessions.length} session(s), ${stocktakeSegmentsStore.length} segment(s), ${zoneAssignmentsStore.length} zone assignments, and ${sessionTombstones.length} tombstone(s).`
          );
        } catch (e) {
        }
        return;
      }
      if (pType === "STOCKTAKE_ZONE_CLAIM") {
        const incomingTime = getTimestamp(packet);
        const existingZone = zoneAssignmentsStore.find((z) => z.sessionId === packet.sessionId && z.zoneId === packet.zoneId);
        const existingTime = existingZone ? getTimestamp(existingZone) : 0;
        if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
          console.log(`[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale STOCKTAKE_ZONE_CLAIM for ${packet.zoneId}`);
          return;
        }
        const { sessionId, zoneId, slot, deviceId, staffId, staffName } = packet;
        if (sessionId && zoneId && (slot === "A" || slot === "B")) {
          let zoneRec = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === zoneId);
          const sessIdxPre = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
          const sessPre = sessIdxPre >= 0 ? stocktakeSessionsStore[sessIdxPre] : null;
          const segPre = sessPre && Array.isArray(sessPre.segments) ? sessPre.segments.find((s) => (s.segmentId || s.id) === zoneId) : null;
          if (zoneRec?.comparisonFinalized || segPre?.comparisonFinalized || slot === "A" && (zoneRec?.teamA?.finalized || segPre?.count1Finalized) || slot === "B" && (zoneRec?.teamB?.finalized || segPre?.count2Finalized)) {
            try {
              ws.send(JSON.stringify({
                type: "STOCKTAKE_SLOT_LOCKED",
                sessionId,
                zoneId,
                slot,
                message: `Team ${slot} / segment comparison is finalized & locked. Auditor unlock required.`,
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            return;
          }
          const cleanStaff = String(staffId || "").trim().toUpperCase();
          const oppositeOwner = String(
            slot === "A" ? zoneRec?.teamB?.staffId || segPre?.counterBId || "" : zoneRec?.teamA?.staffId || segPre?.counterAId || ""
          ).trim().toUpperCase();
          if (cleanStaff && oppositeOwner && oppositeOwner === cleanStaff) {
            try {
              ws.send(JSON.stringify({
                type: "STOCKTAKE_CLAIM_REJECTED",
                sessionId,
                zoneId,
                slot,
                message: `Blind isolation: You already hold Team ${slot === "A" ? "B" : "A"} on this segment and cannot claim Team ${slot}.`,
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            return;
          }
          if (!zoneRec) {
            zoneRec = {
              zoneId,
              zoneName: packet.zoneName || zoneId,
              sessionId,
              branchId: packet.branchId || hubBranchId,
              status: slot === "A" ? "IN_PROGRESS" : "AWAITING_DOUBLE_COUNT"
            };
            zoneAssignmentsStore.push(zoneRec);
          }
          if (slot === "A") {
            zoneRec.teamA = { deviceId, staffId, staffName, claimedAt: (/* @__PURE__ */ new Date()).toISOString(), submitted: false, finalized: false };
            zoneRec.status = zoneRec.teamB?.submitted ? "AWAITING_DOUBLE_COUNT" : "IN_PROGRESS";
          } else {
            zoneRec.teamB = { deviceId, staffId, staffName, claimedAt: (/* @__PURE__ */ new Date()).toISOString(), submitted: false, finalized: false };
          }
          const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
          if (sessIdx >= 0) {
            const sess = stocktakeSessionsStore[sessIdx];
            if (Array.isArray(sess.segments)) {
              const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
              if (seg) {
                if (slot === "A") {
                  seg.counterAId = staffId;
                  seg.counterAName = staffName;
                  seg.counterATimestamp = (/* @__PURE__ */ new Date()).toISOString();
                } else {
                  seg.counterBId = staffId;
                  seg.counterBName = staffName;
                  seg.counterBTimestamp = (/* @__PURE__ */ new Date()).toISOString();
                }
                if (seg.status === "PENDING") seg.status = "COUNTING";
              }
            }
          }
          const segStoreIdx = stocktakeSegmentsStore.findIndex(
            (s) => (s.sessionId === sessionId || !s.sessionId) && (s.segmentId === zoneId || s.id === zoneId)
          );
          if (segStoreIdx >= 0) {
            if (slot === "A") {
              stocktakeSegmentsStore[segStoreIdx].counterAId = staffId;
              stocktakeSegmentsStore[segStoreIdx].counterAName = staffName;
            } else {
              stocktakeSegmentsStore[segStoreIdx].counterBId = staffId;
              stocktakeSegmentsStore[segStoreIdx].counterBName = staffName;
            }
          }
          scheduleSave();
          console.log(`[Termux Hub] Zone ${zoneId} claimed by ${staffName} as Team ${slot}`);
          const claimedPacket = {
            type: "STOCKTAKE_ZONE_CLAIMED",
            sessionId,
            zoneId,
            slot,
            deviceId,
            staffId,
            staffName,
            zone: zoneRec,
            timestamp: Date.now()
          };
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify(claimedPacket));
              } catch (e) {
              }
            }
          });
        }
        return;
      }
      if (pType === "STOCKTAKE_COUNT_SUBMIT") {
        const { sessionId, zoneId, slot, deviceId, staffId, staffName, lines } = packet;
        if (!sessionId || !zoneId || slot !== "A" && slot !== "B" && slot !== "RECOUNT") {
          return;
        }
        const existingZoneCheck = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === zoneId);
        const sessIdxPre = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
        const sessPre = sessIdxPre >= 0 ? stocktakeSessionsStore[sessIdxPre] : null;
        const segPre = sessPre && Array.isArray(sessPre.segments) ? sessPre.segments.find((s) => (s.segmentId || s.id) === zoneId) : null;
        const existingBlindEntry = hubBlindStore[sessionId]?.[zoneId];
        if (slot === "A" || slot === "B") {
          if (existingZoneCheck?.comparisonFinalized || segPre?.comparisonFinalized || slot === "A" && (existingZoneCheck?.teamA?.finalized || segPre?.count1Finalized) || slot === "B" && (existingZoneCheck?.teamB?.finalized || segPre?.count2Finalized)) {
            try {
              ws.send(JSON.stringify({
                type: "STOCKTAKE_SLOT_LOCKED",
                sessionId,
                zoneId,
                slot,
                message: `Team ${slot} count is finalized & locked. Auditor unlock required before re-submitting.`,
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            return;
          }
          const cleanStaff = String(staffId || "").trim().toUpperCase();
          const oppositeOwner = String(
            slot === "A" ? existingBlindEntry?.B?.staffId || existingZoneCheck?.teamB?.staffId || segPre?.counterBId || "" : existingBlindEntry?.A?.staffId || existingZoneCheck?.teamA?.staffId || segPre?.counterAId || ""
          ).trim().toUpperCase();
          if (cleanStaff && oppositeOwner && oppositeOwner === cleanStaff) {
            try {
              ws.send(JSON.stringify({
                type: "STOCKTAKE_CLAIM_REJECTED",
                sessionId,
                zoneId,
                slot,
                message: `Blind isolation: You already counted Team ${slot === "A" ? "B" : "A"} on this segment.`,
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            return;
          }
        }
        if (!hubBlindStore[sessionId]) hubBlindStore[sessionId] = {};
        if (!hubBlindStore[sessionId][zoneId]) {
          hubBlindStore[sessionId][zoneId] = { A: null, B: null, recount: null };
        }
        const finalizedAtIso = (/* @__PURE__ */ new Date()).toISOString();
        hubBlindStore[sessionId][zoneId][slot] = {
          deviceId,
          staffId,
          staffName,
          submittedAt: finalizedAtIso,
          lines: Array.isArray(lines) ? lines : []
        };
        saveBlindVault();
        console.log(`[Hub] Vaulted Team ${slot} count for Zone ${zoneId}. Saved to disk.`);
        let zoneRec = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === zoneId);
        if (!zoneRec) {
          zoneRec = {
            zoneId,
            zoneName: zoneId,
            sessionId,
            branchId: hubBranchId,
            status: slot === "A" ? "AWAITING_DOUBLE_COUNT" : "IN_PROGRESS"
          };
          zoneAssignmentsStore.push(zoneRec);
        }
        if (slot === "A") {
          if (!zoneRec.teamA) {
            zoneRec.teamA = { deviceId, staffId, staffName, claimedAt: finalizedAtIso, submitted: true };
          }
          zoneRec.teamA.staffId = staffId;
          zoneRec.teamA.staffName = staffName;
          zoneRec.teamA.submitted = true;
          zoneRec.teamA.submittedAt = finalizedAtIso;
          zoneRec.teamA.finalized = true;
          zoneRec.teamA.finalizedAt = finalizedAtIso;
          zoneRec.teamA.lineCount = Array.isArray(lines) ? lines.length : 0;
          if (!zoneRec.teamB?.submitted) zoneRec.status = "AWAITING_DOUBLE_COUNT";
        } else if (slot === "B") {
          if (!zoneRec.teamB) {
            zoneRec.teamB = { deviceId, staffId, staffName, claimedAt: finalizedAtIso, submitted: true };
          }
          zoneRec.teamB.staffId = staffId;
          zoneRec.teamB.staffName = staffName;
          zoneRec.teamB.submitted = true;
          zoneRec.teamB.submittedAt = finalizedAtIso;
          zoneRec.teamB.finalized = true;
          zoneRec.teamB.finalizedAt = finalizedAtIso;
          zoneRec.teamB.lineCount = Array.isArray(lines) ? lines.length : 0;
          if (!zoneRec.teamA?.submitted) zoneRec.status = "IN_PROGRESS";
        }
        const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
        if (sessIdx >= 0) {
          const sess = stocktakeSessionsStore[sessIdx];
          if (Array.isArray(sess.segments)) {
            const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
            if (seg) {
              if (slot === "A") {
                seg.hasCountA = true;
                seg.count1Submitted = true;
                seg.count1Finalized = true;
                seg.count1FinalizedAt = finalizedAtIso;
                seg.counterAId = staffId;
                seg.counterAName = staffName;
                if (!seg.count2Submitted) seg.status = "AWAITING_DOUBLE_COUNT";
              } else if (slot === "B") {
                seg.hasCountB = true;
                seg.count2Submitted = true;
                seg.count2Finalized = true;
                seg.count2FinalizedAt = finalizedAtIso;
                seg.counterBId = staffId;
                seg.counterBName = staffName;
              }
            }
          }
        }
        scheduleSave();
        try {
          const ackPacket = {
            type: "STOCKTAKE_ACK_SUBMIT",
            sessionId,
            zoneId,
            slot,
            status: "VAULTED",
            message: `Count for Zone ${zoneId} finalized & secured in Hub Vault. Awaiting Team ${slot === "A" ? "B" : "A"} submission.`,
            timestamp: Date.now()
          };
          ws.send(JSON.stringify(ackPacket));
        } catch (e) {
        }
        const statusPacket = {
          type: "STOCKTAKE_ZONE_STATUS_UPDATE",
          sessionId,
          zoneId,
          slot,
          staffId,
          staffName,
          teamAStaffId: hubBlindStore[sessionId][zoneId].A?.staffId || zoneRec.teamA?.staffId,
          teamBStaffId: hubBlindStore[sessionId][zoneId].B?.staffId || zoneRec.teamB?.staffId,
          teamAStaffName: hubBlindStore[sessionId][zoneId].A?.staffName || zoneRec.teamA?.staffName,
          teamBStaffName: hubBlindStore[sessionId][zoneId].B?.staffName || zoneRec.teamB?.staffName,
          hasCountA: Boolean(hubBlindStore[sessionId][zoneId].A),
          hasCountB: Boolean(hubBlindStore[sessionId][zoneId].B),
          teamAFinalized: Boolean(hubBlindStore[sessionId][zoneId].A),
          teamBFinalized: Boolean(hubBlindStore[sessionId][zoneId].B),
          comparisonFinalized: Boolean(zoneRec.comparisonFinalized),
          status: hubBlindStore[sessionId][zoneId].A && hubBlindStore[sessionId][zoneId].B ? "COMPARING" : slot === "A" ? "AWAITING_DOUBLE_COUNT" : "IN_PROGRESS",
          zone: zoneRec,
          timestamp: Date.now()
        };
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify(statusPacket));
            } catch (e) {
            }
          }
        });
        const subA = hubBlindStore[sessionId][zoneId].A;
        const subB = hubBlindStore[sessionId][zoneId].B;
        if (subA && subB) {
          const mapA = /* @__PURE__ */ new Map();
          const mapB = /* @__PURE__ */ new Map();
          (subA.lines || []).forEach((l) => mapA.set((l.itemId || l.id || "").toUpperCase(), l));
          (subB.lines || []).forEach((l) => mapB.set((l.itemId || l.id || "").toUpperCase(), l));
          const allKeys = Array.from(/* @__PURE__ */ new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]));
          const discrepancies = [];
          const verifiedCounts = [];
          allKeys.forEach((key) => {
            const itemA = mapA.get(key);
            const itemB = mapB.get(key);
            const baseItem = itemA || itemB;
            const upc = Math.max(1, Number(baseItem ? baseItem.unitsPerCase : 1) || 1);
            const aCases = Number(itemA ? itemA.cases : 0) || 0;
            const bCases = Number(itemB ? itemB.cases : 0) || 0;
            const aSingles = Number(itemA ? itemA.singles : 0) || 0;
            const bSingles = Number(itemB ? itemB.singles : 0) || 0;
            const aTot = itemA && itemA.totalUnits !== void 0 && itemA.totalUnits !== null ? Number(itemA.totalUnits) : aCases * upc + aSingles;
            const bTot = itemB && itemB.totalUnits !== void 0 && itemB.totalUnits !== null ? Number(itemB.totalUnits) : bCases * upc + bSingles;
            if (aTot === 0 && bTot === 0) {
              return;
            }
            if (aTot === bTot) {
              verifiedCounts.push({
                itemId: baseItem.itemId || key,
                itemName: baseItem.itemName || key,
                category: baseItem.category,
                sku: baseItem.sku,
                unitsPerCase: upc,
                cases: Math.floor(aTot / upc),
                singles: aTot % upc,
                totalUnits: aTot,
                source: "MATCHED"
              });
            } else {
              discrepancies.push({
                itemId: baseItem.itemId || key,
                itemName: baseItem.itemName || key,
                sku: baseItem.sku || key,
                unitsPerCase: upc,
                teamACases: aCases,
                teamASingles: aSingles,
                teamATotalUnits: aTot,
                teamBCases: bCases,
                teamBSingles: bSingles,
                teamBTotalUnits: bTot,
                differenceUnits: Math.abs(aTot - bTot)
              });
            }
          });
          if (discrepancies.length === 0) {
            const matchIso = (/* @__PURE__ */ new Date()).toISOString();
            console.log(`[Termux Hub] \u2705 Zone ${zoneId} DOUBLE-COUNT MATCHED 100% (${verifiedCounts.length} lines verified).`);
            if (zoneRec) {
              zoneRec.status = "VERIFIED";
              zoneRec.verifiedCounts = verifiedCounts;
              zoneRec.comparisonFinalized = true;
              zoneRec.comparisonFinalizedAt = matchIso;
              zoneRec.comparisonFinalizedBy = `${subA.staffName || "Team A"} & ${subB.staffName || "Team B"}`;
            }
            if (sessIdx >= 0) {
              const sess = stocktakeSessionsStore[sessIdx];
              if (Array.isArray(sess.segments)) {
                const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
                if (seg) {
                  seg.status = "VERIFIED";
                  seg.verifiedCounts = verifiedCounts;
                  seg.discrepancyCount = 0;
                  seg.recount = [];
                  seg.hasCountA = true;
                  seg.hasCountB = true;
                  seg.count1Submitted = true;
                  seg.count2Submitted = true;
                  seg.count1Finalized = true;
                  seg.count2Finalized = true;
                  seg.comparisonFinalized = true;
                  seg.comparisonFinalizedAt = matchIso;
                  seg.comparisonFinalizedBy = `${subA.staffName || "Team A"} & ${subB.staffName || "Team B"}`;
                }
              }
            }
            scheduleSave();
            const verifiedPacket = {
              type: "STOCKTAKE_MATCH_VERIFIED",
              sessionId,
              zoneId,
              status: "VERIFIED",
              comparisonFinalized: true,
              verifiedCounts,
              verifiedCount: verifiedCounts.length,
              zone: zoneRec,
              timestamp: Date.now()
            };
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                try {
                  client.send(JSON.stringify(verifiedPacket));
                } catch (e) {
                }
              }
            });
          } else {
            console.log(`[Termux Hub] \u26A0\uFE0F Zone ${zoneId} DISCREPANCY: ${discrepancies.length} variance item(s), preserving ${verifiedCounts.length} matched line(s). Alerting Teams A & B.`);
            if (zoneRec) {
              zoneRec.status = "VARIANCE_FLAGGED";
              zoneRec.discrepancies = discrepancies;
              zoneRec.verifiedCounts = verifiedCounts;
            }
            if (sessIdx >= 0) {
              const sess = stocktakeSessionsStore[sessIdx];
              if (Array.isArray(sess.segments)) {
                const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
                if (seg) {
                  seg.status = "DISCREPANCY_RECOUNT";
                  seg.discrepancies = discrepancies;
                  seg.discrepancyCount = discrepancies.length;
                  seg.verifiedCounts = verifiedCounts;
                  seg.hasCountA = true;
                  seg.hasCountB = true;
                  seg.count1Submitted = true;
                  seg.count2Submitted = true;
                }
                sess.status = "RECOUNTING";
              }
            }
            scheduleSave();
            const variancePacket = {
              type: "STOCKTAKE_VARIANCE_ALERT",
              sessionId,
              zoneId,
              status: "VARIANCE_FLAGGED",
              discrepancies,
              discrepancyCount: discrepancies.length,
              verifiedCounts,
              matchedCount: verifiedCounts.length,
              teamAStaffName: subA.staffName,
              teamBStaffName: subB.staffName,
              zone: zoneRec,
              timestamp: Date.now()
            };
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                try {
                  client.send(JSON.stringify(variancePacket));
                } catch (e) {
                }
              }
            });
          }
        }
        return;
      }
      if (pType === "STOCKTAKE_JOINT_PROPOSAL") {
        const incomingTime = getTimestamp(packet);
        const existingZone = zoneAssignmentsStore.find((z) => z.zoneId === packet.zoneId && (!packet.sessionId || z.sessionId === packet.sessionId));
        const existingTime = existingZone?.jointRecount?.proposedAt ? getTimestamp({ updatedAt: existingZone.jointRecount.proposedAt }) : existingZone ? getTimestamp(existingZone) : 0;
        if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
          console.log(`[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale STOCKTAKE_JOINT_PROPOSAL for Zone ${packet.zoneId}`);
          return;
        }
        const sessionId = packet.sessionId;
        const zoneId = packet.zoneId;
        const slot = packet.proposedBySlot || packet.slot || "A";
        const staffName = packet.proposedByName || packet.staffName || `Team ${slot}`;
        const lines = packet.recountLines || packet.lines || [];
        console.log(`[Termux Hub] \u270D\uFE0F Joint Recount PROPOSAL from Team ${slot} (${staffName}) for Zone ${zoneId} (${lines.length} lines). Forwarding to peers.`);
        let zoneRec = zoneAssignmentsStore.find((z) => z.zoneId === zoneId && (!sessionId || z.sessionId === sessionId));
        if (!zoneRec) {
          zoneRec = {
            zoneId,
            zoneName: packet.zoneName || `Zone ${zoneId}`,
            sessionId: sessionId || "DEFAULT",
            branchId: packet.branchId || hubBranchId,
            status: "VARIANCE_FLAGGED"
          };
          zoneAssignmentsStore.push(zoneRec);
        }
        if (!zoneRec.jointRecount) {
          zoneRec.jointRecount = {
            signedByA: false,
            signedByB: false,
            lines: []
          };
        }
        zoneRec.jointRecount.lines = lines;
        zoneRec.jointRecount.proposedBy = slot;
        zoneRec.jointRecount.proposedByName = staffName;
        zoneRec.jointRecount.proposedAt = Date.now();
        if (slot === "A") zoneRec.jointRecount.signedByA = true;
        if (slot === "B") zoneRec.jointRecount.signedByB = true;
        const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
        if (sessIdx >= 0) {
          const sess = stocktakeSessionsStore[sessIdx];
          if (Array.isArray(sess.segments)) {
            const seg = sess.segments.find((s) => (s.segmentId || s.id) === zoneId);
            if (seg) {
              seg.jointRecount = zoneRec.jointRecount;
            }
          }
        }
        scheduleSave();
        const proposalBroadcast = {
          type: "STOCKTAKE_JOINT_PROPOSAL",
          sessionId,
          zoneId,
          proposedBySlot: slot,
          proposedByName: staffName,
          recountLines: lines,
          signedByA: zoneRec.jointRecount.signedByA,
          signedByB: zoneRec.jointRecount.signedByB,
          zone: zoneRec,
          timestamp: Date.now()
        };
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify(proposalBroadcast));
            } catch (e) {
            }
          }
        });
        return;
      }
      if (pType === "STOCKTAKE_JOINT_FINALIZED") {
        const incomingTime = getTimestamp(packet);
        const existingZone = zoneAssignmentsStore.find((z) => z.zoneId === packet.zoneId && (!packet.sessionId || z.sessionId === packet.sessionId));
        if (existingZone?.comparisonFinalized) {
          try {
            ws.send(JSON.stringify({
              type: "STOCKTAKE_SLOT_LOCKED",
              sessionId: packet.sessionId,
              zoneId: packet.zoneId,
              message: "Segment joint recount comparison is already finalized & locked. Auditor unlock required.",
              timestamp: Date.now()
            }));
          } catch (e) {
          }
          return;
        }
        const existingTime = existingZone?.jointRecount?.resolvedAt ? getTimestamp({ updatedAt: existingZone.jointRecount.resolvedAt }) : existingZone ? getTimestamp(existingZone) : 0;
        if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
          console.log(`[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale STOCKTAKE_JOINT_FINALIZED for Zone ${packet.zoneId}`);
          return;
        }
        const sessionId = packet.sessionId;
        const zoneId = packet.zoneId;
        const resolvedLines = packet.resolvedLines || packet.lines || [];
        const staffName = packet.resolvedByName || packet.staffName || "Dual Counters";
        const resolvedIso = (/* @__PURE__ */ new Date()).toISOString();
        const mergedMap = /* @__PURE__ */ new Map();
        const addVerifiedEntry = (raw, forcedSource) => {
          if (!raw || !raw.itemId) return;
          const k = String(raw.itemId).trim().toUpperCase();
          const upc = Math.max(1, Number(raw.unitsPerCase || 1));
          const tot = raw.totalUnits !== void 0 && raw.totalUnits !== null ? Number(raw.totalUnits) : Number(raw.cases || 0) * upc + Number(raw.singles || 0);
          const prev = mergedMap.get(k);
          mergedMap.set(k, {
            itemId: raw.itemId,
            itemName: raw.itemName || prev?.itemName || raw.itemId,
            category: raw.category ?? prev?.category,
            sku: raw.sku ?? prev?.sku,
            unitsPerCase: upc,
            cases: Math.floor(tot / upc),
            singles: tot % upc,
            totalUnits: tot,
            source: forcedSource || raw.source || prev?.source || "MATCHED",
            resolvedBy: forcedSource ? staffName : raw.resolvedBy || prev?.resolvedBy
          });
        };
        const vaultKey = `${sessionId || "DEFAULT"}_${zoneId}`;
        const vaultEntry = blindVaultStore[vaultKey];
        if (vaultEntry?.countA?.lines && vaultEntry?.countB?.lines) {
          const vMapA = /* @__PURE__ */ new Map();
          const vMapB = /* @__PURE__ */ new Map();
          (vaultEntry.countA.lines || []).forEach((l) => {
            if (l && l.itemId) vMapA.set(String(l.itemId).trim().toUpperCase(), l);
          });
          (vaultEntry.countB.lines || []).forEach((l) => {
            if (l && l.itemId) vMapB.set(String(l.itemId).trim().toUpperCase(), l);
          });
          (/* @__PURE__ */ new Set([...vMapA.keys(), ...vMapB.keys()])).forEach((k) => {
            const a = vMapA.get(k);
            const b = vMapB.get(k);
            const base = a || b;
            if (!base) return;
            const upc = Math.max(1, Number(base.unitsPerCase || 1));
            const aTot = a ? a.totalUnits !== void 0 && a.totalUnits !== null ? Number(a.totalUnits) : Number(a.cases || 0) * upc + Number(a.singles || 0) : 0;
            const bTot = b ? b.totalUnits !== void 0 && b.totalUnits !== null ? Number(b.totalUnits) : Number(b.cases || 0) * upc + Number(b.singles || 0) : 0;
            if (aTot === bTot && aTot > 0) {
              addVerifiedEntry({ ...base, unitsPerCase: upc, cases: Math.floor(aTot / upc), singles: aTot % upc, totalUnits: aTot, source: "MATCHED" });
            }
          });
        }
        let zoneRec = zoneAssignmentsStore.find((z) => z.zoneId === zoneId && (!sessionId || z.sessionId === sessionId));
        if (zoneRec && Array.isArray(zoneRec.verifiedCounts)) {
          zoneRec.verifiedCounts.forEach((v) => addVerifiedEntry(v));
        }
        const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
        const existingSegForMerge = sessIdx >= 0 && Array.isArray(stocktakeSessionsStore[sessIdx].segments) ? stocktakeSessionsStore[sessIdx].segments.find((s) => (s.segmentId || s.id) === zoneId) : null;
        if (existingSegForMerge && Array.isArray(existingSegForMerge.verifiedCounts)) {
          existingSegForMerge.verifiedCounts.forEach((v) => addVerifiedEntry(v));
        }
        const segIdx = stocktakeSegmentsStore.findIndex((sg) => (sg.segmentId || sg.id) === zoneId);
        if (segIdx >= 0 && Array.isArray(stocktakeSegmentsStore[segIdx].verifiedCounts)) {
          stocktakeSegmentsStore[segIdx].verifiedCounts.forEach((v) => addVerifiedEntry(v));
        }
        resolvedLines.forEach((r) => addVerifiedEntry(r, "JOINT_RECOUNT"));
        const finalVerifiedCounts = Array.from(mergedMap.values());
        console.log(`[Termux Hub] \u{1F3C6} Zone ${zoneId} JOINT RECOUNT FINALIZED & VERIFIED by ${staffName} (${resolvedLines.length} recounted -> ${finalVerifiedCounts.length} total verified lines).`);
        if (zoneRec) {
          zoneRec.status = "VERIFIED";
          zoneRec.verifiedCounts = finalVerifiedCounts;
          zoneRec.comparisonFinalized = true;
          zoneRec.comparisonFinalizedAt = resolvedIso;
          zoneRec.comparisonFinalizedBy = staffName;
          if (!zoneRec.jointRecount) zoneRec.jointRecount = {};
          zoneRec.jointRecount.signedByA = true;
          zoneRec.jointRecount.signedByB = true;
          zoneRec.jointRecount.resolvedAt = Date.now();
          zoneRec.jointRecount.resolvedByName = staffName;
          zoneRec.jointRecount.lines = resolvedLines;
        }
        if (existingSegForMerge) {
          existingSegForMerge.status = "VERIFIED";
          existingSegForMerge.verifiedCounts = finalVerifiedCounts;
          existingSegForMerge.discrepancies = [];
          existingSegForMerge.discrepancyCount = 0;
          existingSegForMerge.comparisonFinalized = true;
          existingSegForMerge.comparisonFinalizedAt = resolvedIso;
          existingSegForMerge.comparisonFinalizedBy = staffName;
        }
        if (segIdx >= 0) {
          stocktakeSegmentsStore[segIdx].status = "VERIFIED";
          stocktakeSegmentsStore[segIdx].verifiedCounts = finalVerifiedCounts;
          stocktakeSegmentsStore[segIdx].discrepancies = [];
          stocktakeSegmentsStore[segIdx].discrepancyCount = 0;
          stocktakeSegmentsStore[segIdx].comparisonFinalized = true;
          stocktakeSegmentsStore[segIdx].comparisonFinalizedAt = resolvedIso;
          stocktakeSegmentsStore[segIdx].comparisonFinalizedBy = staffName;
        }
        scheduleSave();
        const verifiedPacket = {
          type: "STOCKTAKE_MATCH_VERIFIED",
          sessionId,
          zoneId,
          status: "VERIFIED",
          comparisonFinalized: true,
          verifiedCounts: finalVerifiedCounts,
          resolvedByName: staffName,
          source: "JOINT_RECOUNT",
          timestamp: Date.now()
        };
        const statusPacket = {
          type: "STOCKTAKE_ZONE_STATUS_UPDATE",
          sessionId,
          zoneId,
          status: "VERIFIED",
          comparisonFinalized: true,
          verifiedCounts: finalVerifiedCounts,
          timestamp: Date.now()
        };
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify(verifiedPacket));
              client.send(JSON.stringify(statusPacket));
            } catch (e) {
            }
          }
        });
        return;
      }
      if (pType === "STOCKTAKE_SEGMENT_UNLOCK") {
        const { sessionId, zoneId, segmentId, target = "ALL", actorId = "AUDITOR", actorName = "Auditor", reason = "Auditor correction unlock" } = packet;
        const zId = segmentId || zoneId;
        if (sessionId && zId) {
          const nowIso = (/* @__PURE__ */ new Date()).toISOString();
          if (hubBlindStore[sessionId] && hubBlindStore[sessionId][zId]) {
            if (target === "A" || target === "ALL") hubBlindStore[sessionId][zId].A = null;
            if (target === "B" || target === "ALL") hubBlindStore[sessionId][zId].B = null;
            saveBlindVault();
          }
          const zoneRec = zoneAssignmentsStore.find((z) => z.sessionId === sessionId && z.zoneId === zId);
          if (zoneRec) {
            if ((target === "A" || target === "ALL") && zoneRec.teamA) {
              zoneRec.teamA.submitted = false;
              zoneRec.teamA.finalized = false;
            }
            if ((target === "B" || target === "ALL") && zoneRec.teamB) {
              zoneRec.teamB.submitted = false;
              zoneRec.teamB.finalized = false;
            }
            zoneRec.comparisonFinalized = false;
            zoneRec.unlockedReason = reason;
            zoneRec.unlockedByName = actorName;
            zoneRec.unlockedAt = nowIso;
            zoneRec.status = target === "COMPARISON" && zoneRec.discrepancies?.length ? "VARIANCE_FLAGGED" : "IN_PROGRESS";
          }
          const sessIdx = stocktakeSessionsStore.findIndex((s) => s.sessionId === sessionId);
          if (sessIdx >= 0) {
            const sess = stocktakeSessionsStore[sessIdx];
            if (Array.isArray(sess.segments)) {
              const seg = sess.segments.find((s) => (s.segmentId || s.id) === zId);
              if (seg) {
                if (target === "A" || target === "ALL") {
                  seg.count1Finalized = false;
                  seg.count1FinalizedAt = void 0;
                  seg.hasCountA = false;
                  seg.count1Submitted = false;
                }
                if (target === "B" || target === "ALL") {
                  seg.count2Finalized = false;
                  seg.count2FinalizedAt = void 0;
                  seg.hasCountB = false;
                  seg.count2Submitted = false;
                }
                if (target === "COMPARISON" || target === "ALL" || target === "A" || target === "B") {
                  seg.comparisonFinalized = false;
                  seg.comparisonFinalizedAt = void 0;
                  seg.comparisonFinalizedBy = void 0;
                }
                seg.status = target === "COMPARISON" && (seg.discrepancies?.length || seg.recount?.length) ? "DISCREPANCY_RECOUNT" : "COUNTING";
                seg.unlockHistory = [
                  ...Array.isArray(seg.unlockHistory) ? seg.unlockHistory : [],
                  { target, actorId, actorName, reason, unlockedAt: nowIso }
                ];
              }
            }
            if (sess.status === "CONSOLIDATED" || sess.status === "READY_FOR_COMMITTAL") {
              sess.status = "COUNTING";
            }
          }
          scheduleSave();
          console.log(`[Termux Hub] \u{1F513} Segment ${zId} (${target}) unlocked by ${actorName}: ${reason}`);
          const unlockBroadcast = {
            type: "STOCKTAKE_SEGMENT_UNLOCKED",
            sessionId,
            zoneId: zId,
            segmentId: zId,
            target,
            actorId,
            actorName,
            reason,
            unlockedAt: nowIso,
            timestamp: Date.now()
          };
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(JSON.stringify(unlockBroadcast));
              } catch (e) {
              }
            }
          });
        }
        return;
      }
      const isSale = pType === "SALE" || pType === "SALE_RECORD" || pType === "SALE_UPDATE" || pType === "SALE_CREATED" || !!packet.sale;
      const saleObj = packet.sale || packet.data && (packet.data.items || packet.data.total !== void 0 ? packet.data : packet.data.sale) || packet.payload;
      const saleId = saleObj && (saleObj.id || saleObj.invoice_id || saleObj.invoiceId) || packet.invoice_id || packet.invoiceId || packet.id || packet.data && (packet.data.invoice_id || packet.data.id);
      if (isSale && saleId) {
        const senderDeviceId = packet.origin_device_id || packet.originDeviceId || packet.deviceId || "UNKNOWN-DEVICE";
        const isSaleMutation = pType === "SALE_UPDATE" || saleObj?.status === "Refunded" || saleObj?.status === "Voided" || Boolean(saleObj?.mobileVerificationStatus);
        if (!isSaleMutation) {
          const saleClockCheck = validatePacketClock(ws, packet, saleObj, senderDeviceId, "SALE");
          if (!saleClockCheck.accepted) {
            return;
          }
        }
        const isLegacyInv = String(saleId).toUpperCase().startsWith("INV-");
        const existingIdx = salesStore.findIndex((s) => s.id === saleId);
        const prevSale = existingIdx >= 0 ? salesStore[existingIdx] : null;
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, saleObj);
        const resolvedCloudSynced = incomingCloudSynced || Boolean(prevSale && prevSale.isCloudSynced === true);
        const attachedReversalLogs = Array.isArray(saleObj?.reversalCashLogs) ? saleObj.reversalCashLogs : Array.isArray(packet.reversalCashLogs) ? packet.reversalCashLogs : [];
        const cleanSaleObj = saleObj && typeof saleObj === "object" ? { ...saleObj } : saleObj;
        if (cleanSaleObj && "reversalCashLogs" in cleanSaleObj) {
          delete cleanSaleObj.reversalCashLogs;
        }
        if (existingIdx >= 0) {
          const isExistingVoidOrRefund = prevSale.status === "Voided" || prevSale.status === "Refunded";
          const isIncomingCompleted = cleanSaleObj.status !== "Voided" && cleanSaleObj.status !== "Refunded";
          if (isExistingVoidOrRefund && isIncomingCompleted) {
            console.log(`[Termux Hub] \u{1F6E1}\uFE0F Rejected stale Completed status for Sale #${saleId}. Hub is authoritative: invoice is ${prevSale.status}.`);
            try {
              ws.send(JSON.stringify({
                type: "SALE_UPDATE",
                action: "SALE_UPDATE",
                invoice_id: saleId,
                sale: prevSale,
                payload: prevSale,
                status: prevSale.status,
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            return;
          }
          const isExistingMobFinal = prevSale.mobileVerificationStatus === "VERIFIED" || prevSale.mobileVerificationStatus === "FLAGGED";
          const isIncomingMobPending = !cleanSaleObj?.mobileVerificationStatus || cleanSaleObj.mobileVerificationStatus === "PENDING";
          if (isExistingMobFinal && isIncomingMobPending && isIncomingCompleted) {
            console.log(`[Termux Hub] \u{1F6E1}\uFE0F Preserved authoritative mobile verification (${prevSale.mobileVerificationStatus}) for Sale #${saleId}.`);
            try {
              ws.send(JSON.stringify({
                type: "SALE_UPDATE",
                action: "SALE_UPDATE",
                invoice_id: saleId,
                sale: prevSale,
                payload: prevSale,
                status: prevSale.status,
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            return;
          }
          const nowHubMs = Date.now();
          const statusOrVerifyChanged = cleanSaleObj?.status && cleanSaleObj.status !== prevSale?.status || cleanSaleObj?.mobileVerificationStatus && cleanSaleObj.mobileVerificationStatus !== prevSale?.mobileVerificationStatus || Boolean(cleanSaleObj?.hasExchanges && !prevSale?.hasExchanges);
          const mergedSale = {
            ...salesStore[existingIdx],
            ...cleanSaleObj || packet,
            ...resolvedCloudSynced ? { isCloudSynced: true } : {},
            ...statusOrVerifyChanged ? {
              updatedAt: Math.max(nowHubMs, Number(cleanSaleObj?.updatedAt) || 0),
              hubTimestamp: nowHubMs,
              lastUpdated: new Date(nowHubMs).toISOString()
            } : {}
          };
          if (isExistingMobFinal && isIncomingMobPending) {
            mergedSale.mobileVerificationStatus = prevSale.mobileVerificationStatus;
            mergedSale.mobileVerifiedAmountInCurrency = prevSale.mobileVerifiedAmountInCurrency;
            mergedSale.mobileExpectedAmountInCurrency = prevSale.mobileExpectedAmountInCurrency;
            mergedSale.mobileVerifiedRef = prevSale.mobileVerifiedRef;
            mergedSale.mobileVerifiedBy = prevSale.mobileVerifiedBy;
            mergedSale.mobileVerifiedByName = prevSale.mobileVerifiedByName;
            mergedSale.mobileVerifiedAt = prevSale.mobileVerifiedAt;
            mergedSale.mobileDisputeReason = prevSale.mobileDisputeReason;
            mergedSale.mobileDisputeResolution = prevSale.mobileDisputeResolution;
            mergedSale.mobileShortfallUsd = prevSale.mobileShortfallUsd;
          }
          salesStore[existingIdx] = mergedSale;
        } else {
          salesStore.unshift({
            ...cleanSaleObj || packet,
            ...resolvedCloudSynced ? { isCloudSynced: true } : {}
          });
          console.log(`[Termux Hub] \u{1F4E5} Accepted Offline/Online Sale #${saleId} (Append-Only${resolvedCloudSynced ? ", cloud-synced" : ""})`);
        }
        if (attachedReversalLogs.length > 0) {
          attachedReversalLogs.forEach((cl) => upsertHubCashLog(cl, incomingCloudSynced));
        }
        const isNewRefund = saleObj?.status === "Refunded" && prevSale?.status !== "Refunded";
        const isNewVoid = saleObj?.status === "Voided" && prevSale?.status !== "Voided";
        if (saleObj && Array.isArray(saleObj.items)) {
          for (const it of saleObj.items) {
            if (!it || !it.id) continue;
            const invIdx = inventoryStore.findIndex((i) => i.itemId === it.id || i.id === it.id);
            if (invIdx >= 0) {
              const curUnits = Number(inventoryStore[invIdx].totalUnits || 0);
              const qty = Number(it.quantity || 0);
              let newUnits = curUnits;
              if (isNewRefund || isNewVoid) {
                newUnits = Number((curUnits + qty).toFixed(3));
                console.log(`[Termux Hub] Restocked ${qty}x ${it.name || it.id} from ${isNewRefund ? "Refund" : "Void"} on #${saleId}`);
              } else if (!prevSale && saleObj.status !== "Refunded" && saleObj.status !== "Voided") {
                newUnits = Number((curUnits - qty).toFixed(3));
              }
              inventoryStore[invIdx].totalUnits = newUnits;
              inventoryStore[invIdx].stockSingles = newUnits;
              broadcastInventorySnapshot(inventoryStore[invIdx]);
            }
          }
        }
        if (saleObj && Array.isArray(saleObj.exchanges)) {
          const prevExchangeCount = prevSale && Array.isArray(prevSale.exchanges) ? prevSale.exchanges.length : 0;
          const newExchanges = saleObj.exchanges.slice(prevExchangeCount);
          for (const ex of newExchanges) {
            if (ex.returnedItem?.id && ex.returnedItem.restockCondition === "restock") {
              const retIdx = inventoryStore.findIndex((i) => i.itemId === ex.returnedItem.id || i.id === ex.returnedItem.id);
              if (retIdx >= 0) {
                const cur = Number(inventoryStore[retIdx].totalUnits || 0);
                const retUnits = Number((cur + Number(ex.returnedItem.quantity || 1)).toFixed(3));
                inventoryStore[retIdx].totalUnits = retUnits;
                inventoryStore[retIdx].stockSingles = retUnits;
                broadcastInventorySnapshot(inventoryStore[retIdx]);
                console.log(`[Termux Hub] Restocked returned exchange item: +${ex.returnedItem.quantity}x ${ex.returnedItem.name}`);
              }
            }
            if (ex.replacementItem?.id) {
              const repIdx = inventoryStore.findIndex((i) => i.itemId === ex.replacementItem.id || i.id === ex.replacementItem.id);
              if (repIdx >= 0) {
                const cur = Number(inventoryStore[repIdx].totalUnits || 0);
                const repUnits = Number((cur - Number(ex.replacementItem.quantity || 1)).toFixed(3));
                inventoryStore[repIdx].totalUnits = repUnits;
                inventoryStore[repIdx].stockSingles = repUnits;
                broadcastInventorySnapshot(inventoryStore[repIdx]);
                console.log(`[Termux Hub] Depleted replacement exchange item: -${ex.replacementItem.quantity}x ${ex.replacementItem.name}`);
              }
            }
          }
        }
        const amountToLeaveBehind = saleObj?.changeAmountLeftBehind !== void 0 ? Number(saleObj.changeAmountLeftBehind) : Number(saleObj?.changeDue) || 0;
        if (saleObj && saleObj.changeLeftBehind && amountToLeaveBehind > 0) {
          const chgId = `CHG-${saleId}`;
          const existingChgIdx = customerChangesStore.findIndex(
            (c) => c.id === chgId || c.changeId === chgId || c.reference === saleId || c.notes && c.notes.includes(saleId)
          );
          if (existingChgIdx < 0) {
            const chgEntry = {
              id: chgId,
              changeId: chgId,
              timestamp: saleObj.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
              date: saleObj.date || (saleObj.timestamp ? saleObj.timestamp.split("T")[0] : (/* @__PURE__ */ new Date()).toISOString().split("T")[0]),
              staffId: saleObj.staffId || "001",
              staffName: saleObj.staffName || "Cashier",
              customerId: saleObj.customerId || "",
              customerName: saleObj.customerName || "Customer",
              company_id: saleObj.company_id || saleObj.companyId || hubTenantId,
              branch_id: saleObj.branch_id || saleObj.branchId || hubBranchId,
              in: amountToLeaveBehind,
              out: 0,
              notes: `Change left behind (${amountToLeaveBehind.toFixed(2)}) from POS Invoice #${saleId}`,
              reference: saleId
            };
            customerChangesStore.unshift(chgEntry);
            console.log(`[Termux Hub] \u{1F4E5} Extracted Child Customer Change [${chgId}] from Sale #${saleId} ($${amountToLeaveBehind})`);
          }
        }
        if (saleObj && (saleObj.paymentMethod === "Credit" || saleObj.creditAmount && Number(saleObj.creditAmount) > 0)) {
          const crdId = `CR-${saleId}`;
          const existingCrdIdx = creditSalesStore.findIndex(
            (c) => c.id === crdId || c.creditId === crdId || c.notes && c.notes.includes(saleId)
          );
          if (existingCrdIdx < 0) {
            const deposit = Number(saleObj.creditDeposit) || 0;
            const totalCreditAmount = saleObj.creditAmount !== void 0 && Number(saleObj.creditAmount) > 0 ? Number(saleObj.creditAmount) : Number(saleObj.total || 0);
            const crdEntry = {
              id: crdId,
              creditId: crdId,
              timestamp: saleObj.timestamp || (/* @__PURE__ */ new Date()).toISOString(),
              date: saleObj.date || (saleObj.timestamp ? saleObj.timestamp.split("T")[0] : (/* @__PURE__ */ new Date()).toISOString().split("T")[0]),
              staffId: saleObj.staffId || "001",
              staffName: saleObj.staffName || "Staff",
              customerId: saleObj.customerId || "",
              customerName: saleObj.customerName || "Customer",
              company_id: saleObj.company_id || saleObj.companyId || hubTenantId,
              branch_id: saleObj.branch_id || saleObj.branchId || hubBranchId,
              amount: totalCreditAmount,
              out: totalCreditAmount,
              in: deposit,
              itemDescription: saleObj.itemsSummary || "POS Goods on Credit",
              dueDate: saleObj.creditDueDate || "",
              notes: `POS Credit Sale Invoice #${saleId}${deposit > 0 ? ` (${deposit.toFixed(2)} deposit paid)` : ""}`,
              status: deposit >= totalCreditAmount && totalCreditAmount > 0 ? "Paid" : deposit > 0 ? "Partial" : "Pending"
            };
            creditSalesStore.unshift(crdEntry);
            console.log(`[Termux Hub] \u{1F4E5} Extracted Child Credit Sale [${crdId}] from Sale #${saleId} ($${totalCreditAmount})`);
          }
        }
        scheduleSave();
        if (!isLegacyInv) {
          try {
            const ackPacket = {
              type: "SYNC_RECEIPT",
              action: "SYNC_RECEIPT",
              invoice_id: saleId,
              origin_device_id: "LOCAL_HUB",
              origin_device_name: "Termux Local Hub",
              timestamp: Date.now()
            };
            ws.send(JSON.stringify(ackPacket));
            console.log(`[Termux Hub] Sale #${saleId} recorded. Sent SYNC_RECEIPT ACK to sender.`);
          } catch (ackErr) {
          }
        }
        if (incomingCloudSynced) {
          console.log(`[Termux Hub] \u23ED\uFE0F Dual-Writer Skip: Sale #${saleId} already cloud-synced by PWA. Broadcasting T1_CLOUD_SYNC_ACK.`);
          broadcastCloudSyncAck(ws, "SALE", saleId);
        }
      }
      const isGrv = pType === "DIRECT_GRV" || pType === "GRV" || pType === "GRN" || sheetName === "Direct_GRV" || entityType === "grv" || !!packet.directGrv || payload && payload.grvNumber;
      if (isGrv) {
        const grv = packet.directGrv || payload || packet.grv;
        if (grv && (grv.grvNumber || grv.id)) {
          const gId = grv.grvNumber || grv.id;
          const exIdx = directGrvsStore.findIndex((g) => g.grvNumber === gId || g.id === gId);
          const prevGrv = exIdx >= 0 ? directGrvsStore[exIdx] : null;
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, grv);
          const resolvedCloudSynced = incomingCloudSynced || Boolean(prevGrv && prevGrv.isCloudSynced === true);
          if (exIdx >= 0) {
            const isFinalized = prevGrv.status === "APPROVED" || prevGrv.status === "REJECTED";
            if (isFinalized && grv.status === "PENDING") {
              console.log(`[Termux Hub] \u{1F6E1}\uFE0F Retained final status ${prevGrv.status} for GRV #${gId}.`);
              try {
                ws.send(JSON.stringify({
                  type: "DIRECT_GRV",
                  action: "GRV_RECORD",
                  grvNumber: gId,
                  directGrv: prevGrv,
                  payload: prevGrv,
                  timestamp: Date.now()
                }));
              } catch (e) {
              }
              return;
            }
            const mergedGrv = {
              ...directGrvsStore[exIdx],
              ...grv,
              ...resolvedCloudSynced ? { isCloudSynced: true } : {}
            };
            if (prevGrv.paymentStatus === "PAID" && mergedGrv.paymentStatus !== "PAID") {
              mergedGrv.paymentStatus = "PAID";
              mergedGrv.unpaidBalance = 0;
            }
            if (prevGrv.paidVoucherId && !mergedGrv.paidVoucherId) {
              mergedGrv.paidVoucherId = prevGrv.paidVoucherId;
            }
            if (prevGrv.unpaidBalance !== void 0 && mergedGrv.unpaidBalance !== void 0 && Number(mergedGrv.unpaidBalance) > Number(prevGrv.unpaidBalance)) {
              mergedGrv.unpaidBalance = prevGrv.unpaidBalance;
            }
            directGrvsStore[exIdx] = mergedGrv;
          } else {
            directGrvsStore.unshift({
              ...grv,
              ...resolvedCloudSynced ? { isCloudSynced: true } : {}
            });
            console.log(`[Termux Hub] \u{1F4E5} Accepted Offline/Online Direct GRV #${gId} (Append-Only)`);
          }
          const isNewlyRejected = grv.status === "REJECTED" && prevGrv && prevGrv.status !== "REJECTED";
          const isNewlyApprovedOrCreated = grv.status !== "REJECTED" && (!prevGrv || prevGrv.status === "REJECTED");
          if (isNewlyRejected && Array.isArray(grv.items)) {
            for (const item of grv.items) {
              const cleanId = (item.productId || item.itemId || item.id || "").trim();
              if (!cleanId) continue;
              const unitsToDeduct = Number(item.quantity || 0);
              const invIdx = inventoryStore.findIndex(
                (i) => i.itemId === cleanId || i.id === cleanId || item.productName && i.itemName === item.productName
              );
              if (invIdx >= 0) {
                const curUnits = Number(inventoryStore[invIdx].totalUnits || 0);
                inventoryStore[invIdx].totalUnits = Math.max(0, Number((curUnits - unitsToDeduct).toFixed(3)));
                inventoryStore[invIdx].stockSingles = inventoryStore[invIdx].totalUnits;
                console.log(`[Termux Hub] Reverted ${unitsToDeduct}x ${item.productName || cleanId} from rejected GRV #${gId}`);
              }
            }
          } else if (isNewlyApprovedOrCreated && Array.isArray(grv.items)) {
            for (const item of grv.items) {
              const cleanId = (item.productId || item.itemId || item.id || "").trim();
              if (!cleanId) continue;
              const unitsToAdd = Number(item.quantity || 0);
              const invIdx = inventoryStore.findIndex(
                (i) => i.itemId === cleanId || i.id === cleanId || item.productName && i.itemName === item.productName
              );
              if (invIdx >= 0) {
                const curUnits = Number(inventoryStore[invIdx].totalUnits || 0);
                inventoryStore[invIdx].totalUnits = Number((curUnits + unitsToAdd).toFixed(3));
                inventoryStore[invIdx].stockSingles = inventoryStore[invIdx].totalUnits;
                if (item.costPrice) inventoryStore[invIdx].costPrice = item.costPrice;
                if (item.costPerCase) inventoryStore[invIdx].costPerCase = item.costPerCase;
                broadcastInventorySnapshot(inventoryStore[invIdx]);
              } else {
                const newInvRecord = {
                  id: cleanId,
                  itemId: cleanId,
                  itemName: item.productName || cleanId,
                  totalUnits: unitsToAdd,
                  stockSingles: unitsToAdd,
                  costPrice: item.costPrice || 0,
                  costPerCase: item.costPerCase || 0,
                  sellPriceUnit: item.sellingPrice || 0,
                  company_id: grv.companyId || grv.company_id || packet.companyId || "COMP-001",
                  branch_id: grv.branchId || grv.branch_id || packet.branchId || "BR-MAIN",
                  updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
                  hubTimestamp: Date.now(),
                  lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
                };
                inventoryStore.push(newInvRecord);
                broadcastInventorySnapshot(newInvRecord);
              }
            }
          }
          scheduleSave();
          try {
            ws.send(JSON.stringify({
              type: "SYNC_ACK",
              action: "SYNC_ACK",
              entityType: "GRV",
              id: gId,
              updatedAt: Date.now(),
              hubTimestamp: Date.now(),
              lastUpdated: grv.lastUpdated || (/* @__PURE__ */ new Date()).toISOString()
            }));
          } catch (e) {
          }
          if (incomingCloudSynced) {
            console.log(`[Termux Hub] \u23ED\uFE0F Dual-Writer Skip: GRV #${gId} already cloud-synced by PWA. Broadcasting T1_CLOUD_SYNC_ACK.`);
            broadcastCloudSyncAck(ws, "GRV", gId);
          }
        }
      }
      const isInventory = pType === "INVENTORY" || pType === "INVENTORY_RECORD" || pType === "INVENTORY_ITEM" || pType === "INVENTORY_UPDATE" || pType === "INVENTORY_BATCH" || sheetName === "InventoryMaster" || sheetName === "Products" || entityType === "inventory";
      if (isInventory) {
        const items = Array.isArray(payload) ? payload : [payload || packet.item];
        const hubNow = Date.now();
        const hubIso = (/* @__PURE__ */ new Date()).toISOString();
        for (const it of items) {
          if (!it) continue;
          const cleanId = (it.itemId || it.id || "").trim();
          if (!cleanId) continue;
          const incomingTime = getTimestamp(it) || getTimestamp(packet);
          if (isTombstoned(cleanId, "inventory_item", incomingTime)) {
            const tomb = findHubTombstone(cleanId, "inventory_item");
            console.log(`[Termux Hub] \u{1FAA6} Resurrection Blocked for tombstoned inventory item #${cleanId}`);
            if (tomb) {
              try {
                ws.send(JSON.stringify({
                  type: "TOMBSTONE_SYNC",
                  action: "TOMBSTONE_SYNC",
                  entityType: "tombstone",
                  tombstone: tomb,
                  payload: tomb,
                  origin_device_id: "LOCAL_HUB",
                  timestamp: Date.now()
                }));
              } catch (e) {
              }
            }
            continue;
          }
          const exIdx = inventoryStore.findIndex(
            (i) => i.itemId === cleanId || i.id === cleanId || it.sku && i.sku === it.sku
          );
          if (exIdx >= 0) {
            const existing = inventoryStore[exIdx];
            const existingTime = getTimestamp(existing);
            if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
              console.log(
                `[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale inventory update for ${cleanId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative data back.`
              );
              try {
                ws.send(JSON.stringify({
                  type: "INVENTORY_ITEM",
                  action: "INVENTORY_UPDATE",
                  itemId: cleanId,
                  item: existing,
                  payload: existing,
                  updatedAt: existingTime,
                  hubTimestamp: existingTime,
                  lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                  origin_device_id: "LOCAL_HUB",
                  origin_device_name: "Termux Local Hub",
                  timestamp: Date.now()
                }));
              } catch (e) {
              }
              continue;
            }
          }
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, it);
          const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && inventoryStore[exIdx].isCloudSynced === true;
          const stamped = {
            ...it,
            itemId: cleanId,
            id: cleanId,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            ...resolvedCloudSynced ? { isCloudSynced: true } : {}
          };
          if (exIdx >= 0) {
            inventoryStore[exIdx] = { ...inventoryStore[exIdx], ...stamped };
          } else {
            inventoryStore.push(stamped);
          }
          console.log(`[Termux Hub] \u{1F4E6} Updated Inventory Item: ${cleanId} "${it.itemName || ""}" Price: $${it.sellPriceUnit ?? it.price ?? ""} stamped at ${hubIso}`);
          try {
            ws.send(JSON.stringify({
              type: "SYNC_ACK",
              action: "SYNC_ACK",
              entityType: "INVENTORY",
              id: cleanId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso
            }));
          } catch (e) {
          }
          if (incomingCloudSynced) {
            broadcastCloudSyncAck(ws, "INVENTORY", cleanId);
          }
          const broadcastPkt = JSON.stringify({
            type: "INVENTORY_ITEM",
            action: "INVENTORY_UPDATE",
            itemId: cleanId,
            item: stamped,
            payload: stamped,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: hubNow
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(broadcastPkt);
              } catch (e) {
              }
            }
          });
        }
        scheduleSave();
      }
      const isCashMovement = pType === "CASH_MOVEMENT" || pType === "CASH_MOVEMENTS" || sheetName === "CashMovements" || !!packet.movement || payload && payload.shiftId && payload.direction;
      if (isCashMovement) {
        const move = packet.movement || payload;
        if (move && move.id) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, move);
          const exIdx = cashMovementsStore.findIndex((m) => m.id === move.id);
          const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && cashMovementsStore[exIdx].isCloudSynced === true;
          if (exIdx >= 0) {
            cashMovementsStore[exIdx] = { ...cashMovementsStore[exIdx], ...move, ...resolvedCloudSynced ? { isCloudSynced: true } : {} };
          } else {
            cashMovementsStore.unshift({ ...move, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
            console.log(`[Termux Hub] \u{1F4E5} Accepted Cash Movement [${move.id}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CASH_MOVEMENT", move.id);
        }
      }
      const isCashLift = pType === "CASH_LIFT" || pType === "CASH_LIFTS" || sheetName === "CashLifts" || entityType === "cash_lift" || !!packet.cashLift || payload && (payload.liftId || payload.slipNumber);
      if (isCashLift) {
        const lift = packet.cashLift || payload;
        const liftId = lift && (lift.id || lift.liftId || lift.slipNumber);
        if (lift && liftId) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, lift);
          const exIdx = cashLiftsStore.findIndex((l) => l.id === liftId || l.liftId === liftId);
          const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && cashLiftsStore[exIdx].isCloudSynced === true;
          if (exIdx >= 0) {
            cashLiftsStore[exIdx] = { ...cashLiftsStore[exIdx], ...lift, ...resolvedCloudSynced ? { isCloudSynced: true } : {} };
          } else {
            cashLiftsStore.unshift({ ...lift, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
            console.log(`[Termux Hub] \u{1F4E5} Accepted Cash Lift [${liftId}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CASH_LIFT", liftId);
        }
      }
      const isCashLog = pType === "CASH_LOG" || pType === "CASH_LOG_RECORD" || pType === "CASH_LOG_UPDATE" || sheetName === "CashLog" || entityType === "cash_log" || payload && (payload.line || payload.Line) && (payload.in !== void 0 || payload.out !== void 0 || payload.In !== void 0 || payload.Out !== void 0);
      if (isCashLog) {
        const rawLog = packet.cashLog || payload;
        if (rawLog) {
          const senderDeviceId = packet.origin_device_id || packet.originDeviceId || packet.deviceId || "UNKNOWN-DEVICE";
          const cashClockCheck = validatePacketClock(ws, packet, rawLog, senderDeviceId, "CASH_LOG");
          if (!cashClockCheck.accepted) {
            return;
          }
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, rawLog);
          const syncedKey = upsertHubCashLog(rawLog, incomingCloudSynced);
          if (syncedKey) {
            scheduleSave();
            if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CASH_LOG", syncedKey);
          }
        }
      }
      const isCustomerChangePacket = pType === "CUSTOMER_CHANGE" || pType === "CUSTOMER_CHANGE_SYNC" || pType === "customer_change" || sheetName === "CustomerChange" || packet.entityType === "customer_change";
      const changeId = payload ? payload.changeId || payload.id : null;
      const extractHubPosInvRef = (rec, prefix) => {
        if (!rec || typeof rec !== "object") return "";
        const explicitRef = String(rec.reference || rec.invoiceId || rec.saleId || "").trim();
        if (explicitRef) return explicitRef.toUpperCase();
        const rawId = String(rec.id || rec.changeId || rec.creditId || "").trim();
        if (rawId.toUpperCase().startsWith(prefix + "-") && rawId.length > prefix.length + 4) {
          const rest = rawId.slice(prefix.length + 1);
          if (!/^\d{1,4}$/.test(rest) && !/^[A-Z0-9]{4}-[A-Z0-9]+-[A-Z0-9]{3}$/i.test(rest)) {
            return rest.toUpperCase();
          }
        }
        const desc = String(rec.description || rec.notes || "");
        const m = desc.match(/Inv(?:oice)?\s*#?\s*([A-Z0-9][A-Z0-9_-]{3,})/i);
        return m && m[1] ? m[1].trim().toUpperCase() : "";
      };
      if (isCustomerChangePacket && payload && changeId) {
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
        const incomingInvRef = extractHubPosInvRef(payload, "CHG");
        const canonicalChangeId = incomingInvRef ? `CHG-${incomingInvRef}` : changeId;
        let exIdx = customerChangesStore.findIndex((c) => c.changeId === canonicalChangeId || c.id === canonicalChangeId || c.changeId === changeId || c.id === changeId);
        if (exIdx < 0 && incomingInvRef) {
          exIdx = customerChangesStore.findIndex((c) => {
            const ref = extractHubPosInvRef(c, "CHG");
            return ref && ref === incomingInvRef && String(c.customerId || "").trim().toUpperCase() === String(payload.customerId || "").trim().toUpperCase();
          });
        }
        let finalChangeId = canonicalChangeId;
        if (exIdx >= 0) {
          const existing = customerChangesStore[exIdx];
          const sameCust = !payload.customerId || !existing.customerId || String(payload.customerId).trim().toUpperCase() === String(existing.customerId).trim().toUpperCase();
          const sameAmt = Math.abs((Number(payload.in) || 0) - (Number(existing.in) || 0)) < 5e-3 && Math.abs((Number(payload.out) || 0) - (Number(existing.out) || 0)) < 5e-3;
          if (!sameCust || !sameAmt) {
            const sig = `${payload.customerId || ""}|${payload.in || 0}|${payload.out || 0}|${payload.date || ""}|${payload.timestamp || ""}`;
            let h = 2166136261;
            for (let hi = 0; hi < sig.length; hi++) {
              h ^= sig.charCodeAt(hi);
              h = Math.imul(h, 16777619);
            }
            finalChangeId = `${changeId}-C${(h >>> 0).toString(36).toUpperCase().slice(0, 6)}`;
            exIdx = customerChangesStore.findIndex((c) => c.id === finalChangeId || c.changeId === finalChangeId);
          }
        }
        const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && customerChangesStore[exIdx].isCloudSynced === true;
        const normChange = {
          ...payload,
          id: finalChangeId,
          changeId: finalChangeId,
          ...incomingInvRef && !payload.reference ? { reference: incomingInvRef } : {},
          ...resolvedCloudSynced ? { isCloudSynced: true } : {}
        };
        if (exIdx >= 0) {
          customerChangesStore[exIdx] = { ...customerChangesStore[exIdx], ...normChange, id: finalChangeId, changeId: finalChangeId };
        } else {
          customerChangesStore.unshift(normChange);
          console.log(`[Termux Hub] \u{1F4E5} Accepted Customer Change [${finalChangeId}] (Append-Only)`);
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CUSTOMER_CHANGE", finalChangeId);
      }
      const isCreditSalePacket = pType === "CREDIT_SALE" || pType === "CREDIT_SALE_SYNC" || pType === "credit_sale" || sheetName === "CreditSales" || packet.entityType === "credit_sale";
      const creditId = payload ? payload.creditId || payload.id : null;
      if (isCreditSalePacket && payload && creditId) {
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
        const incomingInvRef = extractHubPosInvRef(payload, "CR");
        const canonicalCreditId = incomingInvRef ? `CR-${incomingInvRef}` : creditId;
        let exIdx = creditSalesStore.findIndex((c) => c.creditId === canonicalCreditId || c.id === canonicalCreditId || c.creditId === creditId || c.id === creditId);
        if (exIdx < 0 && incomingInvRef) {
          exIdx = creditSalesStore.findIndex((c) => {
            const ref = extractHubPosInvRef(c, "CR");
            return ref && ref === incomingInvRef && String(c.customerId || "").trim().toUpperCase() === String(payload.customerId || "").trim().toUpperCase();
          });
        }
        let finalCreditId = canonicalCreditId;
        if (exIdx >= 0) {
          const existing = creditSalesStore[exIdx];
          const sameCust = !payload.customerId || !existing.customerId || String(payload.customerId).trim().toUpperCase() === String(existing.customerId).trim().toUpperCase();
          const sameAmt = Math.abs((Number(payload.out ?? payload.amount) || 0) - (Number(existing.out ?? existing.amount) || 0)) < 5e-3 && Math.abs((Number(payload.in) || 0) - (Number(existing.in) || 0)) < 5e-3;
          if (!sameCust || !sameAmt) {
            const sig = `${payload.customerId || ""}|${payload.out ?? payload.amount ?? 0}|${payload.in || 0}|${payload.date || ""}|${payload.timestamp || ""}`;
            let h = 2166136261;
            for (let hi = 0; hi < sig.length; hi++) {
              h ^= sig.charCodeAt(hi);
              h = Math.imul(h, 16777619);
            }
            finalCreditId = `${creditId}-C${(h >>> 0).toString(36).toUpperCase().slice(0, 6)}`;
            exIdx = creditSalesStore.findIndex((c) => c.id === finalCreditId || c.creditId === finalCreditId);
          }
        }
        const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && creditSalesStore[exIdx].isCloudSynced === true;
        const normCredit = {
          ...payload,
          id: finalCreditId,
          creditId: finalCreditId,
          ...incomingInvRef && !payload.reference ? { reference: incomingInvRef } : {},
          ...resolvedCloudSynced ? { isCloudSynced: true } : {}
        };
        if (exIdx >= 0) {
          creditSalesStore[exIdx] = { ...creditSalesStore[exIdx], ...normCredit, id: finalCreditId, creditId: finalCreditId };
        } else {
          creditSalesStore.unshift(normCredit);
          console.log(`[Termux Hub] \u{1F4E5} Accepted Credit Sale [${finalCreditId}] (Append-Only)`);
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CREDIT_SALE", finalCreditId);
      }
      const isCreditGroupPacket = pType === "CREDIT_GROUP_SYNC" || pType === "credit_group" || sheetName === "CreditGroups" || packet.entityType === "credit_group";
      const groupId = payload ? payload.id || payload.groupId : null;
      if (isCreditGroupPacket && payload && groupId) {
        const incomingTime = getTimestamp(payload) || getTimestamp(packet);
        if (isTombstoned(groupId, "credit_group", incomingTime)) {
          console.log(`[Termux Hub] \u{1FAA6} Resurrection Blocked for tombstoned credit group #${groupId}`);
        } else {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
          const exIdx = creditGroupsStore.findIndex((g) => g.id === groupId || g.groupId === groupId);
          const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && creditGroupsStore[exIdx].isCloudSynced === true;
          const stampedTime = incomingTime || Date.now();
          if (exIdx >= 0) {
            const existingTime = getTimestamp(creditGroupsStore[exIdx]) || 0;
            if (stampedTime >= existingTime - 6e4) {
              creditGroupsStore[exIdx] = { ...creditGroupsStore[exIdx], ...payload, id: groupId, ...resolvedCloudSynced ? { isCloudSynced: true } : {} };
              console.log(`[Termux Hub] \u{1F504} Updated Credit Group [${groupId}] via LWW`);
            }
          } else {
            creditGroupsStore.push({ ...payload, id: groupId, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
            console.log(`[Termux Hub] \u{1F4E5} Added new Credit Group [${groupId}]`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CREDIT_GROUP", groupId);
        }
      }
      const isDailyBlindConfigPacket = pType === "DAILY_BLIND_CONFIG" || pType === "DAILY_BLIND_CONFIG_SYNC" || pType === "daily_blind_config" || sheetName === "DailyBlindConfigs" || packet.entityType === "daily_blind_config";
      const dbcPayload = (payload && typeof payload === "object" ? payload : null) || (packet.config && typeof packet.config === "object" ? packet.config : null) || (isDailyBlindConfigPacket ? packet : null);
      const dbcId = dbcPayload ? dbcPayload.id || dbcPayload.configId || packet.id || packet.entityId : "";
      if (isDailyBlindConfigPacket && dbcPayload && dbcId) {
        const incomingTime = getTimestamp(dbcPayload) || getTimestamp(packet) || Date.now();
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, dbcPayload);
        const cleanCfg = {
          id: dbcId,
          company_id: dbcPayload.company_id || dbcPayload.companyId || packet.company_id || packet.companyId || hubTenantId,
          branch_id: dbcPayload.branch_id || dbcPayload.branchId || packet.branch_id || packet.branchId || hubBranchId,
          selectedItemIds: Array.isArray(dbcPayload.selectedItemIds) ? dbcPayload.selectedItemIds : [],
          designatedAuditorId: dbcPayload.designatedAuditorId,
          designatedAuditorName: dbcPayload.designatedAuditorName,
          updatedBy: dbcPayload.updatedBy,
          updatedByName: dbcPayload.updatedByName,
          updatedAt: incomingTime,
          version: Number(dbcPayload.version || 1),
          mutationSource: dbcPayload.mutationSource || "USER_EDIT"
        };
        const exIdx = dailyBlindConfigsStore.findIndex((c) => c && String(c.id).toUpperCase() === String(dbcId).toUpperCase());
        const resolvedCloudSynced = incomingCloudSynced;
        if (exIdx >= 0) {
          const existingTime = getTimestamp(dailyBlindConfigsStore[exIdx]) || 0;
          if (incomingTime >= existingTime - 6e4) {
            dailyBlindConfigsStore[exIdx] = {
              ...dailyBlindConfigsStore[exIdx],
              ...cleanCfg,
              id: dbcId,
              isCloudSynced: resolvedCloudSynced
            };
          }
        } else {
          dailyBlindConfigsStore.push({ ...cleanCfg, id: dbcId, isCloudSynced: resolvedCloudSynced });
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, "DAILY_BLIND_CONFIG", dbcId);
      }
      const isDailyBlindCountPacket = pType === "DAILY_BLIND_COUNT" || pType === "DAILY_BLIND_COUNT_SYNC" || pType === "daily_blind_count" || sheetName === "DailyBlindCounts" || packet.entityType === "daily_blind_count";
      const dbcntPayload = (payload && typeof payload === "object" ? payload : null) || (packet.record && typeof packet.record === "object" ? packet.record : null) || (isDailyBlindCountPacket ? packet : null);
      const dbcntId = dbcntPayload ? dbcntPayload.id || dbcntPayload.countId || packet.id || packet.entityId : "";
      if (isDailyBlindCountPacket && dbcntPayload && dbcntId) {
        const statusRank = { SUBMITTED: 1, EXPLANATION_REQUESTED: 2, EXPLANATION_SUBMITTED: 3, ARCHIVED: 4 };
        const incomingTime = getTimestamp(dbcntPayload) || getTimestamp(packet) || Date.now();
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, dbcntPayload);
        const cleanCount = {
          ...dbcntPayload,
          id: dbcntId,
          company_id: dbcntPayload.company_id || dbcntPayload.companyId || packet.company_id || packet.companyId || hubTenantId,
          branch_id: dbcntPayload.branch_id || dbcntPayload.branchId || packet.branch_id || packet.branchId || hubBranchId,
          updatedAt: incomingTime,
          reportOnly: true
        };
        delete cleanCount.type;
        delete cleanCount.action;
        delete cleanCount.payload;
        delete cleanCount.record;
        const exIdx = dailyBlindCountsStore.findIndex((r) => r && String(r.id).toUpperCase() === String(dbcntId).toUpperCase());
        const resolvedCloudSynced = incomingCloudSynced;
        if (exIdx >= 0) {
          const existingRec = dailyBlindCountsStore[exIdx];
          const exRank = statusRank[existingRec.status] || 1;
          const incRank = statusRank[cleanCount.status] || 1;
          const existingTime = getTimestamp(existingRec) || 0;
          if (existingRec.status !== "ARCHIVED" || cleanCount.status === "ARCHIVED") {
            if (incRank > exRank || incRank === exRank && incomingTime >= existingTime - 6e4) {
              dailyBlindCountsStore[exIdx] = {
                ...existingRec,
                ...cleanCount,
                id: dbcntId,
                reportOnly: true,
                isCloudSynced: resolvedCloudSynced
              };
            }
          }
        } else {
          dailyBlindCountsStore.push({
            ...cleanCount,
            id: dbcntId,
            reportOnly: true,
            isCloudSynced: resolvedCloudSynced
          });
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, "DAILY_BLIND_COUNT", dbcntId);
      }
      const isPurchaseOrderPacket = pType === "PURCHASE_ORDER" || pType === "PURCHASE_ORDER_SYNC" || pType === "PURCHASE_ORDERS" || pType === "purchase_order" || sheetName === "PurchaseOrders" || packet.entityType === "purchase_order";
      const poPayload = (packet.purchaseOrder && typeof packet.purchaseOrder === "object" ? packet.purchaseOrder : null) || (payload && typeof payload === "object" ? payload : null) || (isPurchaseOrderPacket ? packet : null);
      const poId = poPayload ? poPayload.id || poPayload.poNumber || packet.id || packet.entityId : "";
      if (isPurchaseOrderPacket && poPayload && poId) {
        const poStatusRank = {
          DRAFT: 1,
          REJECTED: 2,
          PENDING_APPROVAL: 3,
          APPROVED: 4,
          PARTIALLY_RECEIVED: 5,
          RECEIVED: 6,
          CANCELLED: 7
        };
        const incomingTime = getTimestamp(poPayload) || getTimestamp(packet) || Date.now();
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, poPayload);
        const cleanPo = {
          ...poPayload,
          id: poId,
          poNumber: poPayload.poNumber || poId,
          company_id: poPayload.company_id || poPayload.companyId || packet.company_id || packet.companyId || hubTenantId,
          branch_id: poPayload.branch_id || poPayload.branchId || packet.branch_id || packet.branchId || hubBranchId,
          updatedAt: incomingTime
        };
        delete cleanPo.type;
        delete cleanPo.action;
        delete cleanPo.payload;
        delete cleanPo.purchaseOrder;
        const exIdx = purchaseOrdersStore.findIndex(
          (r) => r && (String(r.id || "").toUpperCase() === String(poId).toUpperCase() || String(r.poNumber || "").toUpperCase() === String(poId).toUpperCase())
        );
        if (exIdx >= 0) {
          const existingRec = purchaseOrdersStore[exIdx];
          const exRank = poStatusRank[existingRec.status] || 1;
          const incRank = poStatusRank[cleanPo.status] || 1;
          const existingTime = getTimestamp(existingRec) || 0;
          const shouldApply = !(exRank >= 4 && incRank < 4 && incomingTime <= existingTime + 12e4) && (incRank > exRank || incomingTime >= existingTime - 2e3);
          if (shouldApply) {
            const linkedGrvs = Array.from(
              new Set([...existingRec.linkedGrvIds || [], ...cleanPo.linkedGrvIds || []].filter(Boolean))
            );
            const exLineMap = /* @__PURE__ */ new Map();
            (Array.isArray(existingRec.lines) ? existingRec.lines : []).forEach((l) => {
              if (l && l.lineId) exLineMap.set(l.lineId, l);
            });
            const mergedLines = (Array.isArray(cleanPo.lines) ? cleanPo.lines : existingRec.lines || []).map((l) => {
              const prev = l && l.lineId ? exLineMap.get(l.lineId) : null;
              if (!prev) return l;
              return {
                ...l,
                receivedUnits: Math.max(Number(l.receivedUnits || 0), Number(prev.receivedUnits || 0)),
                receivedCases: Math.max(Number(l.receivedCases || 0), Number(prev.receivedCases || 0))
              };
            });
            purchaseOrdersStore[exIdx] = {
              ...existingRec,
              ...cleanPo,
              id: existingRec.id || poId,
              lines: mergedLines,
              linkedGrvIds: linkedGrvs,
              approvedById: cleanPo.approvedById || existingRec.approvedById,
              approvedByName: cleanPo.approvedByName || existingRec.approvedByName,
              approvedAt: cleanPo.approvedAt || existingRec.approvedAt,
              isCloudSynced: incomingCloudSynced
            };
          }
        } else {
          purchaseOrdersStore.push({
            ...cleanPo,
            id: poId,
            isCloudSynced: incomingCloudSynced
          });
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, "PURCHASE_ORDER", poId);
      }
      const movRawPayload = packet.movements || packet.movement || payload;
      const isStockMovementPkt = pType === "STOCK_MOVEMENT" || pType === "STOCK_MOVEMENT_RECORD" || pType === "STOCK_MOVEMENT_BATCH" || entityType === "stock_movement" || sheetName === "StockMovement" || sheetName === "StockMovements";
      if (isStockMovementPkt && movRawPayload) {
        const movList = Array.isArray(movRawPayload) ? movRawPayload : [movRawPayload];
        let acceptedCount = 0;
        for (const movPayload of movList) {
          const rawMovId = movPayload && (movPayload.id || movPayload.movementId || movPayload.txnId);
          if (!movPayload || !rawMovId) continue;
          const mId = String(rawMovId).trim();
          const baseMovId = stripHubStockMovementDupSuffix(mId);
          const movItemId = String(movPayload.itemId || "").trim();
          const isDupClone = mId !== baseMovId && stockMovementsStore.some((m) => {
            const existingId = String(m.id || m.movementId || m.txnId || "").trim();
            const existingBase = stripHubStockMovementDupSuffix(existingId);
            const existingItemId = String(m.itemId || "").trim();
            return existingBase === baseMovId && (!movItemId || !existingItemId || existingItemId === movItemId);
          });
          if (isDupClone) {
            console.log(`[Termux Hub] \u{1F6E1}\uFE0F Ignored duplicate echo Stock Movement [${mId}] (base [${baseMovId}] already exists)`);
            continue;
          }
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, movPayload);
          const exIdx = stockMovementsStore.findIndex((m) => {
            const existingId = String(m.id || m.movementId || m.txnId || "").trim();
            return existingId === mId || m.id === mId || m.movementId === mId || m.txnId === mId;
          });
          const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && stockMovementsStore[exIdx].isCloudSynced === true;
          const normalizedMov = {
            ...movPayload,
            id: movPayload.id || mId,
            movementId: movPayload.movementId || mId,
            txnId: movPayload.txnId || mId,
            ...resolvedCloudSynced ? { isCloudSynced: true } : {}
          };
          if (exIdx >= 0) {
            stockMovementsStore[exIdx] = { ...stockMovementsStore[exIdx], ...normalizedMov };
          } else {
            stockMovementsStore.unshift(normalizedMov);
          }
          acceptedCount++;
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "STOCK_MOVEMENT", mId);
        }
        if (acceptedCount > 0) {
          console.log(`[Termux Hub] \u{1F4E5} Accepted ${acceptedCount} Stock Movement(s) (Append-Only)`);
          scheduleSave();
        }
      }
      if ((pType === "EXPENSE" || pType === "expense" || sheetName === "Expenses" || packet.entityType === "expense") && payload && payload.id) {
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
        const exIdx = expensesStore.findIndex((e) => e.id === payload.id);
        const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && expensesStore[exIdx].isCloudSynced === true;
        if (exIdx >= 0) {
          const prevExp = expensesStore[exIdx];
          const prevSt = String(prevExp.status || "").toLowerCase();
          const incSt = String(payload.status || "").toLowerCase();
          const prevFinal = prevSt === "approved" || prevSt === "rejected";
          const incPending = !incSt || incSt === "pending" || incSt === "pending_supervisor";
          if (prevFinal && incPending) {
            try {
              ws.send(JSON.stringify({
                type: "EXPENSE",
                action: "EXPENSE",
                expense: prevExp,
                payload: prevExp,
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            return;
          }
          const nowExpMs = Date.now();
          expensesStore[exIdx] = {
            ...prevExp,
            ...payload,
            updatedAt: Math.max(nowExpMs, Number(payload.updatedAt) || 0),
            hubTimestamp: nowExpMs,
            lastUpdated: new Date(nowExpMs).toISOString(),
            ...resolvedCloudSynced ? { isCloudSynced: true } : {}
          };
        } else {
          expensesStore.unshift({ ...payload, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
          console.log(`[Termux Hub] \u{1F4E5} Accepted Expense [${payload.id}] (Append-Only)`);
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, "EXPENSE", payload.id);
      }
      if ((pType === "INTERNAL_CONSUMPTION" || pType === "SHOP_USE" || sheetName === "InternalConsumption") && (packet.internalConsumption || payload) && (packet.internalConsumption?.id || payload?.id)) {
        const icObj = packet.internalConsumption || payload;
        const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, icObj);
        const exIdx = internalConsumptionsStore.findIndex((c) => c.id === icObj.id);
        const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && internalConsumptionsStore[exIdx].isCloudSynced === true;
        if (exIdx >= 0) {
          const prevIc = internalConsumptionsStore[exIdx];
          const prevFinal = prevIc.status === "APPROVED" || prevIc.status === "REJECTED";
          const incPending = !icObj.status || icObj.status === "PENDING" || icObj.status === "PENDING_APPROVAL";
          if (prevFinal && incPending) {
            try {
              ws.send(JSON.stringify({
                type: "INTERNAL_CONSUMPTION",
                action: "INTERNAL_CONSUMPTION_RECORD",
                internalConsumption: prevIc,
                payload: prevIc,
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            return;
          }
          internalConsumptionsStore[exIdx] = { ...prevIc, ...icObj, ...resolvedCloudSynced ? { isCloudSynced: true } : {} };
        } else {
          internalConsumptionsStore.unshift({ ...icObj, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
          console.log(`[Termux Hub] \u{1F4E5} Accepted Shop Use / Internal Consumption [${icObj.id}]`);
        }
        scheduleSave();
        if (incomingCloudSynced) broadcastCloudSyncAck(ws, "INTERNAL_CONSUMPTION", icObj.id);
      }
      const trObj = packet.cashTransfer || payload;
      const isCashTransferPkt = pType === "CASH_TRANSFER" || pType === "CASH_TRANSFER_SYNC" || pType === "CASH_TRANSFER_UPDATE" || pType === "CASH_TRANSFER_RECORD" || pType === "cash_transfer" || sheetName === "CashTransfers" || sheetName === "cash_transfers" || entityType === "cash_transfer" || Boolean(packet.cashTransfer);
      if (isCashTransferPkt && trObj && (trObj.transfer_id || trObj.id)) {
        const tId = String(trObj.transfer_id || trObj.id).trim();
        const rawAmt = typeof trObj.amount === "number" ? trObj.amount : parseFloat(String(trObj.amount || "0"));
        const safeAmt = Number.isFinite(rawAmt) ? Math.round(rawAmt * 100) / 100 : NaN;
        if (!Number.isFinite(safeAmt) || safeAmt < 0 || safeAmt > 1e7) {
          console.warn(`[Termux Hub] \u{1F6E1}\uFE0F Rejected invalid Cash Transfer amount for ${tId}: ${trObj.amount}`);
        } else {
          const getTrRank = (st) => {
            const u = String(st || "").toUpperCase().trim();
            if (u === "DRAFT") return 0;
            if (u === "PENDING_APPROVAL" || u === "PENDING_ACCEPTANCE") return 1;
            if (u === "IN_TRANSIT") return 2;
            if (u === "APPROVED") return 3;
            if (u === "RECEIVED" || u === "COMPLETED" || u === "RETURNED" || u === "CANCELLED" || u === "REJECTED") return 4;
            return 0;
          };
          const trTypeUpper = String(trObj.type || "").toUpperCase().trim();
          const trBranchUpper = String(trObj.branch_id || "").toUpperCase().trim();
          const isGlobalTransfer = trBranchUpper === "HQ" || trBranchUpper === "ALL" || String(trObj.target_branch_id || "").toUpperCase().trim() === "ALL" || trTypeUpper === "HQ_TO_BRANCH" || trTypeUpper === "BRANCH_TO_HQ" || trTypeUpper === "BANK_DEPOSIT" || trTypeUpper === "BANK_WITHDRAWAL" || trTypeUpper === "ELECTRONIC_SETTLEMENT" || trTypeUpper === "CAPITAL_INFUSION" || trTypeUpper === "SUPPLIER_PAYMENT" || trTypeUpper === "THIRD_PARTY_PAYOUT";
          const hubNow = Date.now();
          const hubIso = new Date(hubNow).toISOString();
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, trObj);
          const exIdx = cashTransfersStore.findIndex((t) => String(t.transfer_id || t.id || "").trim() === tId);
          const prevTr = exIdx >= 0 ? cashTransfersStore[exIdx] : null;
          const prevRank = prevTr ? getTrRank(prevTr.status) : -1;
          const nextRank = getTrRank(trObj.status);
          if (prevTr && nextRank < prevRank) {
            console.log(`[Termux Hub] \u{1F6E1}\uFE0F Rejected stale Cash Transfer downgrade for ${tId} (${trObj.status} < ${prevTr.status})`);
            try {
              ws.send(JSON.stringify({
                packetId: `HUB-TRF-FIX-${tId}-${prevTr.status || "ST"}-${hubNow}`,
                type: "CASH_TRANSFER",
                action: "CASH_TRANSFER_UPDATE",
                entityType: "cash_transfer",
                target_branch_id: isGlobalTransfer ? "ALL" : prevTr.branch_id || "BR-MAIN",
                companyId: prevTr.company_id || packet.companyId,
                branchId: prevTr.branch_id || packet.branchId,
                cashTransfer: prevTr,
                payload: prevTr,
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: hubNow
              }));
            } catch (e) {
            }
            return;
          } else {
            const prevLinksCount = Array.isArray(prevTr?.linked_cash_log_ids) ? prevTr.linked_cash_log_ids.length : 0;
            const nextLinksCount = Array.isArray(trObj.linked_cash_log_ids) ? trObj.linked_cash_log_ids.length : 0;
            const hasMeaningfulChange = !prevTr || nextRank > prevRank || String(prevTr.status || "").toUpperCase() !== String(trObj.status || "").toUpperCase() || nextLinksCount > prevLinksCount || trObj.received_by_user_id && trObj.received_by_user_id !== prevTr.received_by_user_id || trObj.approved_by_user_id && trObj.approved_by_user_id !== prevTr.approved_by_user_id;
            const resolvedCloudSynced = incomingCloudSynced || !hasMeaningfulChange && Boolean(prevTr && prevTr.isCloudSynced === true);
            const mergedLinks = Array.from(
              /* @__PURE__ */ new Set([
                ...Array.isArray(prevTr?.linked_cash_log_ids) ? prevTr.linked_cash_log_ids : [],
                ...Array.isArray(trObj.linked_cash_log_ids) ? trObj.linked_cash_log_ids : []
              ])
            );
            const stampedTransfer = {
              ...prevTr || {},
              ...trObj,
              transfer_id: tId,
              amount: safeAmt,
              rank: Math.max(prevRank, nextRank),
              linked_cash_log_ids: mergedLinks,
              target_branch_id: isGlobalTransfer ? "ALL" : trObj.target_branch_id || trObj.branch_id || prevTr?.branch_id || "BR-MAIN",
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
              isCloudSynced: resolvedCloudSynced
            };
            if (exIdx >= 0) {
              cashTransfersStore[exIdx] = stampedTransfer;
              console.log(`[Termux Hub] \u{1F504} Updated Cash Transfer [${tId}] -> ${stampedTransfer.status} (cloudSynced=${resolvedCloudSynced})`);
            } else {
              cashTransfersStore.unshift(stampedTransfer);
              console.log(`[Termux Hub] \u{1F4E5} Accepted Cash Transfer [${tId}] (${stampedTransfer.type} $${safeAmt.toFixed(2)}, status=${stampedTransfer.status})`);
            }
            scheduleSave();
            try {
              ws.send(JSON.stringify({
                type: "SYNC_ACK",
                action: "SYNC_ACK",
                entityType: "CASH_TRANSFER",
                id: tId,
                updatedAt: hubNow,
                hubTimestamp: hubNow,
                lastUpdated: hubIso
              }));
            } catch (e) {
            }
            if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CASH_TRANSFER", tId);
            const trBroadcastStr = JSON.stringify({
              packetId: `HUB-TRF-${tId}-${stampedTransfer.status || "ST"}-${hubNow}`,
              type: "CASH_TRANSFER",
              action: stampedTransfer.status && stampedTransfer.status !== "DRAFT" ? "CASH_TRANSFER_UPDATE" : "CASH_TRANSFER",
              entityType: "cash_transfer",
              target_branch_id: stampedTransfer.target_branch_id,
              companyId: stampedTransfer.company_id || packet.companyId,
              branchId: stampedTransfer.branch_id || packet.branchId,
              cashTransfer: stampedTransfer,
              payload: stampedTransfer,
              origin_device_id: "LOCAL_HUB",
              origin_device_name: "Termux Local Hub",
              timestamp: hubNow
            });
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                try {
                  client.send(trBroadcastStr);
                } catch (e) {
                }
              }
            });
            return;
          }
        }
      }
      const isSupplier = pType === "SUPPLIER_SYNC" || pType === "SUPPLIER" || pType === "supplier" || pType === "SUPPLIER_RECORD" || sheetName === "Suppliers" || sheetName === "suppliers" || entityType === "supplier" || entityType === "Suppliers" || Boolean(packet.supplier);
      const suppObj = packet.supplier || payload;
      if (isSupplier && suppObj) {
        const sId = suppObj.supplierId || suppObj.id || suppObj.SupplierID;
        const incomingTime = getTimestamp(suppObj) || getTimestamp(packet);
        if (sId && isTombstoned(sId, "supplier", incomingTime)) {
          const tomb = findHubTombstone(sId, "supplier");
          console.log(`[Termux Hub] \u{1FAA6} Resurrection Blocked for tombstoned supplier #${sId}`);
          if (tomb) {
            try {
              ws.send(JSON.stringify({ type: "TOMBSTONE_SYNC", action: "TOMBSTONE_SYNC", entityType: "tombstone", tombstone: tomb, payload: tomb, origin_device_id: "LOCAL_HUB", timestamp: Date.now() }));
            } catch (e) {
            }
          }
        } else if (sId) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, suppObj);
          const exIdx = suppliersStore.findIndex((s) => (s.supplierId || s.id || s.SupplierID) === sId);
          const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && suppliersStore[exIdx].isCloudSynced === true;
          if (exIdx >= 0) {
            suppliersStore[exIdx] = { ...suppliersStore[exIdx], ...suppObj, supplierId: sId, ...resolvedCloudSynced ? { isCloudSynced: true } : {} };
          } else {
            suppliersStore.unshift({ ...suppObj, supplierId: sId, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
            console.log(`[Termux Hub] \u{1F4E5} Accepted Supplier [${sId}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "SUPPLIER", sId);
        }
      }
      const isAdminSale = pType === "ADMIN_SALES" || pType === "ADMIN_SALES_SYNC" || pType === "admin_sales" || sheetName === "AdminSales";
      if (isAdminSale && payload) {
        const asId = payload.id || `AS-${payload.date}-${payload.staffId}`;
        if (asId) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
          const exIdx = adminSalesStore.findIndex((a) => a.id === asId);
          const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && adminSalesStore[exIdx].isCloudSynced === true;
          if (exIdx >= 0) {
            adminSalesStore[exIdx] = { ...adminSalesStore[exIdx], ...payload, id: asId, ...resolvedCloudSynced ? { isCloudSynced: true } : {} };
          } else {
            adminSalesStore.unshift({ ...payload, id: asId, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
            console.log(`[Termux Hub] \u{1F4E5} Accepted Admin Sale [${asId}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "ADMIN_SALES", asId);
        }
      }
      const isCashCount = pType === "CASH_COUNT" || pType === "CASH_COUNT_SYNC" || pType === "CASH_COUNT_RECORD" || pType === "cash_count" || sheetName === "CashCounts" || packet.entityType === "cash_count" || Boolean(packet.cashCount);
      const ccPayload = packet.cashCount && typeof packet.cashCount === "object" ? packet.cashCount : payload;
      if (isCashCount && ccPayload) {
        const ccId = String(ccPayload.id || packet.recordId || packet.entityId || "").trim();
        if (ccId || ccPayload.staffId && ccPayload.date) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, ccPayload);
          const normComp = String(ccPayload.company_id || ccPayload.companyId || packet.companyId || "COMP-001").trim().toUpperCase();
          const normBr = String(ccPayload.branch_id || ccPayload.branchId || packet.branchId || "BR-MAIN").trim().toUpperCase();
          const normStaff = String(ccPayload.staffId || "").trim().toUpperCase();
          const normDate = String(ccPayload.date || "").trim();
          const exIdx = cashCountsStore.findIndex((c) => {
            if (ccId && c.id === ccId) return true;
            if (!normStaff || !normDate) return false;
            const cComp = String(c.company_id || c.companyId || "COMP-001").trim().toUpperCase();
            const cBr = String(c.branch_id || c.branchId || "BR-MAIN").trim().toUpperCase();
            const cStaff = String(c.staffId || "").trim().toUpperCase();
            return cComp === normComp && cBr === normBr && cStaff === normStaff && String(c.date || "").trim() === normDate;
          });
          const hubNow = Date.now();
          const incomingTs = Math.max(
            Number(ccPayload.updatedAt || 0),
            Number(packet.updatedAt || 0),
            getTimestamp(ccPayload) || 0
          ) || hubNow;
          const existingTs = exIdx >= 0 ? getTimestamp(cashCountsStore[exIdx]) : 0;
          if (exIdx >= 0 && existingTs > 0 && incomingTs < existingTs) {
            if (incomingCloudSynced && cashCountsStore[exIdx].isCloudSynced !== true) {
              cashCountsStore[exIdx].isCloudSynced = true;
              scheduleSave();
            }
          } else {
            const finalId = ccId || (exIdx >= 0 ? cashCountsStore[exIdx].id : `CNT-${hubNow}`);
            const isNewerLocalEdit = exIdx >= 0 && !incomingCloudSynced && (incomingTs > existingTs || Math.abs(Number(ccPayload.finalCashOutTotal || 0) - Number(cashCountsStore[exIdx].finalCashOutTotal || 0)) > 5e-3 || String(ccPayload.notes || "") !== String(cashCountsStore[exIdx].notes || ""));
            const resolvedCloudSynced = incomingCloudSynced ? true : isNewerLocalEdit ? false : exIdx >= 0 && cashCountsStore[exIdx].isCloudSynced === true;
            const mergedCc = {
              ...exIdx >= 0 ? cashCountsStore[exIdx] : {},
              ...ccPayload,
              id: finalId,
              company_id: ccPayload.company_id || ccPayload.companyId || normComp,
              companyId: ccPayload.companyId || ccPayload.company_id || normComp,
              branch_id: ccPayload.branch_id || ccPayload.branchId || normBr,
              branchId: ccPayload.branchId || ccPayload.branch_id || normBr,
              updatedAt: Math.max(incomingTs, hubNow),
              hubTimestamp: hubNow,
              lastUpdated: new Date(Math.max(incomingTs, hubNow)).toISOString(),
              isCloudSynced: resolvedCloudSynced
            };
            delete mergedCc.fromMesh;
            delete mergedCc.fromSync;
            if (exIdx >= 0) {
              cashCountsStore[exIdx] = mergedCc;
              console.log(`[Termux Hub] \u{1F504} Updated Cash Count [${finalId}] ($${Number(mergedCc.finalCashOutTotal || 0).toFixed(2)})`);
            } else {
              cashCountsStore.unshift(mergedCc);
              console.log(`[Termux Hub] \u{1F4E5} Accepted Cash Count [${finalId}] ($${Number(mergedCc.finalCashOutTotal || 0).toFixed(2)})`);
            }
            scheduleSave();
            if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CASH_COUNT", finalId);
          }
        }
      }
      const isVoucher = pType === "VOUCHER" || pType === "VOUCHER_SYNC" || pType === "voucher" || pType === "supplier_invoice" || sheetName === "SupplierInvoices" || sheetName === "Vouchers";
      if (isVoucher && payload) {
        const vId = payload.voucherId || payload.id;
        if (vId) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
          const exIdx = vouchersStore.findIndex((v) => (v.voucherId || v.id) === vId);
          const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && vouchersStore[exIdx].isCloudSynced === true;
          if (exIdx >= 0) {
            vouchersStore[exIdx] = { ...vouchersStore[exIdx], ...payload, voucherId: vId, ...resolvedCloudSynced ? { isCloudSynced: true } : {} };
          } else {
            vouchersStore.unshift({ ...payload, voucherId: vId, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
            console.log(`[Termux Hub] \u{1F4E5} Accepted Voucher [${vId}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "VOUCHER", vId);
        }
      }
      const isClosure = pType === "CLOSURE_SYNC" || pType === "CLOSURE" || pType === "closure" || pType === "EOD" || sheetName === "BusinessDayClosures" || sheetName === "Closures";
      if (isClosure && payload) {
        const cId = payload.id || `EOD-${payload.date}-${payload.branchId || "BR-MAIN"}`;
        if (cId) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
          const exIdx = businessDayClosuresStore.findIndex((c) => c.id === cId || c.date === payload.date && c.branchId === payload.branchId);
          const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && businessDayClosuresStore[exIdx].isCloudSynced === true;
          if (exIdx >= 0) {
            businessDayClosuresStore[exIdx] = { ...businessDayClosuresStore[exIdx], ...payload, id: cId, ...resolvedCloudSynced ? { isCloudSynced: true } : {} };
          } else {
            businessDayClosuresStore.unshift({ ...payload, id: cId, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
            console.log(`[Termux Hub] \u{1F4E5} Accepted Closure [${cId}] (Append-Only)`);
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CLOSURE", cId);
        }
      }
      const isSettlement = pType === "SETTLEMENT_SYNC" || pType === "SETTLEMENT" || pType === "settlement" || pType === "ELECTRONIC_SETTLEMENT" || pType === "ELECTRONIC_SETTLEMENT_SYNC" || entityType === "electronic_settlement" || sheetName === "ElectronicSettlements" || sheetName === "Settlements" || Boolean(packet.settlement);
      const settleObj = packet.settlement || payload;
      if (isSettlement && settleObj) {
        const sBranch = settleObj.branchId || settleObj.branch_id || packet.branchId || "BR-MAIN";
        const sComp = settleObj.company_id || settleObj.companyId || packet.companyId || packet.company_id || "COMP-001";
        const sId = settleObj.id || `SETTLE-${settleObj.date}-${sBranch}`;
        if (sId) {
          const hubNow = Date.now();
          const hubIso = new Date(hubNow).toISOString();
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, settleObj);
          const normSComp = (v) => {
            const u = String(v || "COMP-001").trim().toUpperCase();
            return !u || u === "DEFAULT" || u === "COMP-001" || u === "COMP-MASTER" ? "COMP-001" : u;
          };
          const exIdx = electronicSettlementsStore.findIndex(
            (s) => s.id === sId || s.date === settleObj.date && (s.branchId || s.branch_id) === sBranch && normSComp(s.company_id || s.companyId) === normSComp(sComp)
          );
          const prevSt = exIdx >= 0 ? electronicSettlementsStore[exIdx] : null;
          const resolvedCloudSynced = incomingCloudSynced || prevSt && prevSt.isCloudSynced === true;
          const stampedSettlement = {
            ...prevSt || {},
            ...settleObj,
            id: sId,
            companyId: sComp,
            company_id: sComp,
            branchId: sBranch,
            branch_id: sBranch,
            target_branch_id: "ALL",
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            ...resolvedCloudSynced ? { isCloudSynced: true } : {}
          };
          if (exIdx >= 0) {
            electronicSettlementsStore[exIdx] = stampedSettlement;
            console.log(`[Termux Hub] \u{1F504} Updated Electronic Settlement [${sId}] (${stampedSettlement.date})`);
          } else {
            electronicSettlementsStore.unshift(stampedSettlement);
            console.log(`[Termux Hub] \u{1F4E5} Accepted Electronic Settlement [${sId}] (${stampedSettlement.date})`);
          }
          scheduleSave();
          try {
            ws.send(JSON.stringify({
              type: "SYNC_ACK",
              action: "SYNC_ACK",
              entityType: "ELECTRONIC_SETTLEMENT",
              id: sId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso
            }));
          } catch (e) {
          }
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "ELECTRONIC_SETTLEMENT", sId);
          const stBroadcastStr = JSON.stringify({
            type: "SETTLEMENT_SYNC",
            action: "SETTLEMENT_SYNC",
            target_branch_id: "ALL",
            companyId: sComp,
            branchId: sBranch,
            settlement: stampedSettlement,
            payload: stampedSettlement,
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: hubNow
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(stBroadcastStr);
              } catch (e) {
              }
            }
          });
        }
      }
      const isCategory = pType === "CATEGORY_SYNC" || pType === "CATEGORIES_SYNC" || pType === "category" || pType === "categories" || sheetName === "Categories";
      if (isCategory && payload) {
        const rawCats = Array.isArray(payload) ? payload : payload.categories || payload.item || payload.data;
        if (Array.isArray(rawCats)) {
          const existingTime = Math.max(
            ...categoriesStore.map((c) => getTimestamp(c)),
            getTimestamp(categoriesStore),
            0
          );
          const incomingTime = getTimestamp(payload);
          if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
            console.log(
              `[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale Categories update (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative categories back.`
            );
            try {
              ws.send(JSON.stringify({
                type: "CATEGORIES_SYNC",
                action: "CATEGORIES_SYNC",
                categories: categoriesStore,
                payload: categoriesStore,
                origin_device_id: "LOCAL_HUB",
                hubTimestamp: Date.now()
              }));
            } catch (e) {
            }
          } else {
            categoriesStore = rawCats.filter((c) => !isTombstoned(getTombstoneRecordId(c, "inventory_category"), "inventory_category", getTimestamp(c) || incomingTime));
            console.log(`[Termux Hub] \u{1F4E5} Accepted Categories update (${categoriesStore.length} categories, LWW Accepted)`);
            scheduleSave();
          }
        }
      }
      const rawStaffObj = packet.staff || (payload && (payload.pin_hash || payload.pin || payload.role) ? payload : null);
      let staffObj = null;
      if (rawStaffObj) {
        staffObj = { ...rawStaffObj };
        delete staffObj.pin;
      }
      const isStaff = pType === "STAFF" || pType === "STAFF_SYNC" || pType === "STAFF_RECORD" || sheetName === "Salespeople" || sheetName === "users" || !!staffObj;
      if (isStaff && staffObj && staffObj.id) {
        const hubNow = Date.now();
        const hubIso = (/* @__PURE__ */ new Date()).toISOString();
        const incomingTime = getTimestamp(staffObj) || getTimestamp(packet);
        if (isTombstoned(staffObj.id, "staff", incomingTime)) {
          const tomb = findHubTombstone(staffObj.id, "staff");
          console.log(`[Termux Hub] \u{1FAA6} Resurrection Blocked for tombstoned staff #${staffObj.id}`);
          if (tomb) {
            try {
              ws.send(JSON.stringify({ type: "TOMBSTONE_SYNC", action: "TOMBSTONE_SYNC", entityType: "tombstone", tombstone: tomb, payload: tomb, origin_device_id: "LOCAL_HUB", timestamp: Date.now() }));
            } catch (e) {
            }
          }
          return;
        }
        const sIdx = salespeopleStore.findIndex((s) => s.id === staffObj.id);
        let accepted = true;
        if (sIdx >= 0) {
          const existing = salespeopleStore[sIdx];
          const existingTime = getTimestamp(existing);
          if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
            console.log(
              `[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale staff update for ${staffObj.name || staffObj.id} (${staffObj.id}) (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
            );
            try {
              ws.send(JSON.stringify({
                type: "STAFF",
                action: "STAFF_SYNC",
                staff: existing,
                payload: existing,
                updatedAt: existingTime,
                hubTimestamp: existingTime,
                lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            accepted = false;
          }
        }
        if (accepted) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, rawStaffObj, staffObj);
          const resolvedCloudSynced = incomingCloudSynced || sIdx >= 0 && salespeopleStore[sIdx].isCloudSynced === true;
          staffObj.updatedAt = hubNow;
          staffObj.hubTimestamp = hubNow;
          staffObj.lastUpdated = hubIso;
          if (resolvedCloudSynced) staffObj.isCloudSynced = true;
          if (sIdx >= 0) {
            salespeopleStore[sIdx] = { ...salespeopleStore[sIdx], ...staffObj };
          } else {
            salespeopleStore.unshift(staffObj);
          }
          scheduleSave();
          console.log(`[Termux Hub] \u{1F464} Synced Staff account securely: ${staffObj.name} (${staffObj.id} - ${staffObj.role}) stamped at ${hubIso}`);
          try {
            ws.send(JSON.stringify({
              type: "SYNC_ACK",
              action: "SYNC_ACK",
              entityType: "STAFF",
              id: staffObj.id,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso
            }));
          } catch (e) {
          }
          const staffBroadcastStr = JSON.stringify({
            type: "STAFF",
            action: "STAFF_SYNC",
            staff: staffObj,
            payload: staffObj,
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: hubNow
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(staffBroadcastStr);
              } catch (e) {
              }
            }
          });
          if (incomingCloudSynced) {
            console.log(`[Termux Hub] \u23ED\uFE0F Dual-Writer Skip: STAFF #${staffObj.id} already cloud-synced by PWA. Broadcasting T1_CLOUD_SYNC_ACK.`);
            broadcastCloudSyncAck(ws, "STAFF", staffObj.id);
          } else {
            pushToCloud("STAFF", staffObj);
          }
        }
      }
      if (pType === "PERMISSIONS_MATRIX" || pType === "PERMISSIONS_MATRIX_SYNC") {
        const incomingRules = packet.rules || packet.permissionsMatrix?.rules || (Array.isArray(payload) ? payload : payload?.rules);
        if (Array.isArray(incomingRules) && incomingRules.length > 0) {
          const hubNow = Date.now();
          const incomingTime = Number(packet.updatedAt ?? packet.permissionsMatrix?.updatedAt ?? packet.timestamp) || hubNow;
          const existingTime = Number(permissionsMatrixStore.updatedAt) || 0;
          if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
            try {
              ws.send(JSON.stringify({
                type: "PERMISSIONS_MATRIX_SYNC",
                action: "PERMISSIONS_MATRIX_SYNC",
                rules: permissionsMatrixStore.rules,
                permissionsMatrix: permissionsMatrixStore,
                updatedAt: existingTime,
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
          } else {
            const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
            permissionsMatrixStore = { rules: incomingRules, updatedAt: hubNow, ...incomingCloudSynced ? { isCloudSynced: true } : {} };
            scheduleSave();
            console.log(`[Termux Hub] \u{1F510} Synced Permissions Matrix (${incomingRules.length} rules)`);
            try {
              ws.send(JSON.stringify({
                type: "SYNC_ACK",
                action: "SYNC_ACK",
                entityType: "PERMISSIONS_MATRIX",
                updatedAt: hubNow
              }));
            } catch (e) {
            }
            const permsBroadcastStr = JSON.stringify({
              type: "PERMISSIONS_MATRIX_SYNC",
              action: "PERMISSIONS_MATRIX_SYNC",
              rules: permissionsMatrixStore.rules,
              permissionsMatrix: permissionsMatrixStore,
              payload: permissionsMatrixStore,
              updatedAt: hubNow,
              origin_device_id: packet.origin_device_id || packet.originDeviceId || "LOCAL_HUB",
              origin_device_name: packet.origin_device_name || packet.originDeviceName || "Termux Local Hub",
              timestamp: hubNow
            });
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                try {
                  client.send(permsBroadcastStr);
                } catch (e) {
                }
              }
            });
            if (!incomingCloudSynced) {
              pushToCloud("PERMISSIONS_MATRIX", permissionsMatrixStore);
            }
          }
        }
        return;
      }
      if (pType === "ROLE_CONFIGS" || pType === "ROLE_CONFIGS_SYNC") {
        const incomingDefs = packet.definitions || packet.roleConfigs?.definitions || payload?.definitions || (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null);
        if (incomingDefs && typeof incomingDefs === "object") {
          const hubNow = Date.now();
          const incomingTime = Number(packet.updatedAt ?? packet.roleConfigs?.updatedAt ?? packet.timestamp) || hubNow;
          const existingTime = Number(roleConfigsStore.updatedAt) || 0;
          if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
            try {
              ws.send(JSON.stringify({
                type: "ROLE_CONFIGS_SYNC",
                action: "ROLE_CONFIGS_SYNC",
                definitions: roleConfigsStore.definitions,
                roleConfigs: roleConfigsStore,
                updatedAt: existingTime,
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
          } else {
            const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, payload);
            roleConfigsStore = { definitions: incomingDefs, updatedAt: hubNow, ...incomingCloudSynced ? { isCloudSynced: true } : {} };
            scheduleSave();
            console.log(`[Termux Hub] \u{1F6E1}\uFE0F Synced Role Configurations`);
            try {
              ws.send(JSON.stringify({
                type: "SYNC_ACK",
                action: "SYNC_ACK",
                entityType: "ROLE_CONFIGS",
                updatedAt: hubNow
              }));
            } catch (e) {
            }
            const rolesBroadcastStr = JSON.stringify({
              type: "ROLE_CONFIGS_SYNC",
              action: "ROLE_CONFIGS_SYNC",
              definitions: roleConfigsStore.definitions,
              roleConfigs: roleConfigsStore,
              payload: roleConfigsStore,
              updatedAt: hubNow,
              origin_device_id: packet.origin_device_id || packet.originDeviceId || "LOCAL_HUB",
              origin_device_name: packet.origin_device_name || packet.originDeviceName || "Termux Local Hub",
              timestamp: hubNow
            });
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                try {
                  client.send(rolesBroadcastStr);
                } catch (e) {
                }
              }
            });
            if (!incomingCloudSynced) {
              pushToCloud("ROLE_CONFIGS", roleConfigsStore);
            }
          }
        }
        return;
      }
      if (pType === "MULTI_CURRENCY" || pType === "MULTI_CURRENCY_SYNC" || pType === "EXCHANGE_RATES" || pType === "EXCHANGE_RATES_SYNC") {
        const incomingMc = packet.multiCurrencyConfig || packet.exchangeRates || payload?.multiCurrencyConfig || payload?.exchangeRates || (payload && typeof payload === "object" && payload.rates ? payload : null);
        if (incomingMc && typeof incomingMc === "object" && incomingMc.rates) {
          const hubNow = Date.now();
          const hubIso = new Date(hubNow).toISOString();
          const rawIncomingTs = packet.updatedAt ?? incomingMc.updatedAt ?? incomingMc.lastUpdated ?? packet.timestamp;
          const incomingTime = incomingMc.isSystemDefault === true ? 0 : getTimestamp({ updatedAt: rawIncomingTs });
          const existingTime = Number(multiCurrencyStore.updatedAt) || 0;
          if (existingTime > 0 && (incomingTime === 0 || existingTime > incomingTime + 6e4)) {
            console.log(
              `[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale Multi-Currency update (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${incomingTime > 0 ? new Date(incomingTime).toISOString() : "SystemDefault"}). Sending authoritative rates back.`
            );
            try {
              ws.send(JSON.stringify({
                type: "MULTI_CURRENCY_SYNC",
                action: "MULTI_CURRENCY_SYNC",
                entityType: "multi_currency",
                recordId: "MULTI_CURRENCY_CONFIG",
                multiCurrencyConfig: multiCurrencyStore.config,
                exchangeRates: multiCurrencyStore.config,
                payload: multiCurrencyStore.config,
                updatedAt: existingTime,
                hubTimestamp: existingTime,
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
          } else if (incomingTime > 0 || existingTime === 0) {
            const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, incomingMc);
            const resolvedCloudSynced = incomingCloudSynced || Boolean(multiCurrencyStore.config && multiCurrencyStore.config.isCloudSynced === true);
            const storedMc = {
              ...incomingMc,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
              isSystemDefault: false,
              ...resolvedCloudSynced ? { isCloudSynced: true } : {}
            };
            multiCurrencyStore = { config: storedMc, updatedAt: hubNow };
            scheduleSave();
            console.log(
              `[Termux Hub] \u{1F4B1} Synced Multi-Currency Config (Base: ${storedMc.baseCurrency || "USD"}) stamped at ${hubIso}`
            );
            try {
              ws.send(JSON.stringify({
                type: "SYNC_ACK",
                action: "SYNC_ACK",
                entityType: "MULTI_CURRENCY",
                recordId: "MULTI_CURRENCY_CONFIG",
                updatedAt: hubNow,
                hubTimestamp: hubNow,
                lastUpdated: hubIso
              }));
            } catch (e) {
            }
            const mcBroadcastStr = JSON.stringify({
              type: "MULTI_CURRENCY_SYNC",
              action: "MULTI_CURRENCY_SYNC",
              entityType: "multi_currency",
              recordId: "MULTI_CURRENCY_CONFIG",
              multiCurrencyConfig: storedMc,
              exchangeRates: storedMc,
              payload: storedMc,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso,
              origin_device_id: packet.origin_device_id || packet.originDeviceId || "LOCAL_HUB",
              origin_device_name: packet.origin_device_name || packet.originDeviceName || "Termux Local Hub",
              timestamp: hubNow
            });
            wss.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                try {
                  client.send(mcBroadcastStr);
                } catch (e) {
                }
              }
            });
            if (incomingCloudSynced) {
              console.log(`[Termux Hub] \u23ED\uFE0F Dual-Writer Skip: MULTI_CURRENCY already cloud-synced by PWA. Broadcasting T1_CLOUD_SYNC_ACK.`);
              broadcastCloudSyncAck(ws, "MULTI_CURRENCY", "MULTI_CURRENCY_CONFIG");
            } else {
              pushToCloud("MULTI_CURRENCY", storedMc);
            }
          }
        }
        return;
      }
      const isExplicitCustType = pType === "CUSTOMER" || pType === "CUSTOMER_SYNC" || pType === "CUSTOMER_RECORD" || pType === "customer" || sheetName === "Customers" || packet.entityType === "customer" || Boolean(packet.customer);
      const rawCustCandidate = packet.customer || (isExplicitCustType ? payload : null);
      const isNonCustomerTransactionBlob = !rawCustCandidate || typeof rawCustCandidate !== "object" || "changeId" in rawCustCandidate || "creditId" in rawCustCandidate || "creditSaleId" in rawCustCandidate || "invoiceNumber" in rawCustCandidate || Array.isArray(rawCustCandidate.items) || "in" in rawCustCandidate && "out" in rawCustCandidate;
      const custObj = isExplicitCustType && !isNonCustomerTransactionBlob ? rawCustCandidate : null;
      if (custObj && (custObj.customerId || custObj.id)) {
        const cId = custObj.customerId || custObj.id;
        const incomingName = String(custObj.name || custObj.CustomerName || custObj.customerName || "").trim();
        const hubNow = Date.now();
        const hubIso = (/* @__PURE__ */ new Date()).toISOString();
        const incomingTime = getTimestamp(custObj) || getTimestamp(packet);
        if (isTombstoned(cId, "customer", incomingTime)) {
          const tomb = findHubTombstone(cId, "customer");
          console.log(`[Termux Hub] \u{1FAA6} Resurrection Blocked for tombstoned customer #${cId}`);
          if (tomb) {
            try {
              ws.send(JSON.stringify({ type: "TOMBSTONE_SYNC", action: "TOMBSTONE_SYNC", entityType: "tombstone", tombstone: tomb, payload: tomb, origin_device_id: "LOCAL_HUB", timestamp: Date.now() }));
            } catch (e) {
            }
          }
          return;
        }
        const cIdx = customersStore.findIndex((c) => (c.customerId || c.id) === cId);
        if (cIdx < 0 && !incomingName) {
          console.log(`[Termux Hub] \u{1F6E1}\uFE0F Ignored blank-name customer payload for ${cId}`);
          return;
        }
        let accepted = true;
        if (cIdx >= 0) {
          const existing = customersStore[cIdx];
          const existingTime = getTimestamp(existing);
          if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
            console.log(
              `[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale customer update for ${cId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
            );
            try {
              ws.send(JSON.stringify({
                type: "CUSTOMER",
                action: "CUSTOMER_SYNC",
                customer: existing,
                payload: existing,
                updatedAt: existingTime,
                hubTimestamp: existingTime,
                lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            accepted = false;
          }
        }
        if (accepted) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, custObj);
          const resolvedCloudSynced = incomingCloudSynced || cIdx >= 0 && customersStore[cIdx].isCloudSynced === true;
          const existingCust = cIdx >= 0 ? customersStore[cIdx] : null;
          const preservedName = incomingName || String(existingCust?.name || existingCust?.CustomerName || "").trim();
          const savedCust = {
            ...existingCust || {},
            ...custObj,
            customerId: cId,
            id: cId,
            name: preservedName,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            ...resolvedCloudSynced ? { isCloudSynced: true } : {}
          };
          if (cIdx >= 0) {
            customersStore[cIdx] = savedCust;
          } else {
            customersStore.unshift(savedCust);
          }
          scheduleSave();
          console.log(`[Termux Hub] \u{1F465} Synced Customer account: ${savedCust.name} (${cId}) stamped at ${hubIso}`);
          try {
            ws.send(JSON.stringify({
              type: "SYNC_ACK",
              action: "SYNC_ACK",
              entityType: "CUSTOMER",
              id: cId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso
            }));
          } catch (e) {
          }
          const custBroadcastStr = JSON.stringify({
            type: "CUSTOMER",
            action: "CUSTOMER_SYNC",
            customer: savedCust,
            payload: savedCust,
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: hubNow
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(custBroadcastStr);
              } catch (e) {
              }
            }
          });
          if (incomingCloudSynced) {
            console.log(`[Termux Hub] \u23ED\uFE0F Dual-Writer Skip: CUSTOMER #${cId} already cloud-synced by PWA. Broadcasting T1_CLOUD_SYNC_ACK.`);
            broadcastCloudSyncAck(ws, "CUSTOMER", cId);
          } else {
            pushToCloud("CUSTOMER", savedCust);
          }
        }
      }
      const rawBranchObj = packet.branch || (entityType === "branch" || sheetName === "Branches" || sheetName === "branches" ? payload : null);
      const isExplicitBranchType = pType === "BRANCH" || pType === "BRANCH_SYNC" || pType === "BRANCH_RECORD" || pType === "branch" || entityType === "branch" || sheetName === "Branches" || sheetName === "branches" || packet.type === "BRANCH_SYNC" || packet.type === "BRANCH" || packet.action === "BRANCH_SYNC" || Boolean(packet.branch);
      const isValidBranchSchema = isValidBranchRecord(rawBranchObj);
      const isBranch = isExplicitBranchType && isValidBranchSchema;
      if (isBranch && rawBranchObj && (rawBranchObj.branchId || rawBranchObj.id || rawBranchObj.branch_id || rawBranchObj.BranchID)) {
        const rawBId = rawBranchObj.branchId || rawBranchObj.id || rawBranchObj.branch_id || rawBranchObj.BranchID;
        const bId = canonicalizeHubBranchId(rawBId);
        const bComp = normHubBranchTenant(rawBranchObj.company_id || rawBranchObj.companyId || rawBranchObj.CompanyID || packet.companyId || packet.company_id || hubTenantId);
        const hubNow = Date.now();
        const hubIso = (/* @__PURE__ */ new Date()).toISOString();
        const incomingTime = getTimestamp(rawBranchObj) || getTimestamp(packet);
        if (isTombstoned(bId, "branch", incomingTime)) {
          const tomb = findHubTombstone(bId, "branch");
          console.log(`[Termux Hub] \u{1FAA6} Resurrection Blocked for tombstoned branch #${bId}`);
          if (tomb) {
            try {
              ws.send(JSON.stringify({ type: "TOMBSTONE_SYNC", action: "TOMBSTONE_SYNC", entityType: "tombstone", tombstone: tomb, payload: tomb, origin_device_id: "LOCAL_HUB", timestamp: Date.now() }));
            } catch (e) {
            }
          }
          return;
        }
        const incomingName = String(rawBranchObj.name || rawBranchObj.branch_name || rawBranchObj.branchName || rawBranchObj.Name || "").trim();
        const incomingCode = String(rawBranchObj.code || rawBranchObj.branch_code || rawBranchObj.branchCode || rawBranchObj.Code || "").trim();
        const incomingLoc = String(rawBranchObj.location || rawBranchObj.address || rawBranchObj.Location || rawBranchObj.Address || "").trim();
        let bIdx = branchesStore.findIndex(
          (b) => normHubBranchTenant(b.company_id || b.companyId || hubTenantId) === bComp && canonicalizeHubBranchId(b.branchId || b.id || b.branch_id).toUpperCase() === bId.toUpperCase()
        );
        if (bIdx < 0 && incomingCode && !isHubPlaceholderBranchCode(incomingCode, bId)) {
          bIdx = branchesStore.findIndex(
            (b) => normHubBranchTenant(b.company_id || b.companyId || hubTenantId) === bComp && String(b.code || "").trim().toUpperCase() === incomingCode.toUpperCase()
          );
        }
        let accepted = true;
        if (bIdx >= 0) {
          const existing = branchesStore[bIdx];
          const existingTime = getTimestamp(existing);
          if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
            console.log(
              `[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale branch update for ${bId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
            );
            try {
              ws.send(JSON.stringify({
                type: "BRANCH",
                action: "BRANCH_SYNC",
                branch: existing,
                payload: existing,
                updatedAt: existingTime,
                hubTimestamp: existingTime,
                lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            accepted = false;
          }
        }
        if (accepted) {
          const existing = bIdx >= 0 ? branchesStore[bIdx] : null;
          const resolvedId = existing ? canonicalizeHubBranchId(existing.branchId || bId) : bId;
          const resolvedName = !isHubPlaceholderBranchName(incomingName) ? incomingName : existing && !isHubPlaceholderBranchName(existing.name) ? existing.name : incomingName || existing?.name || "Main Branch";
          const resolvedCode = !isHubPlaceholderBranchCode(incomingCode, resolvedId) ? incomingCode : existing && !isHubPlaceholderBranchCode(existing.code, resolvedId) ? existing.code : incomingCode || existing?.code || resolvedId;
          const resolvedLoc = incomingLoc || existing?.location || existing?.address || "";
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, rawBranchObj);
          const resolvedCloudSynced = incomingCloudSynced || existing && existing.isCloudSynced === true;
          const stamped = {
            ...existing || {},
            ...rawBranchObj,
            branchId: resolvedId,
            id: resolvedId,
            branch_id: resolvedId,
            company_id: bComp,
            companyId: bComp,
            name: resolvedName,
            code: resolvedCode,
            location: resolvedLoc,
            address: resolvedLoc,
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            ...resolvedCloudSynced ? { isCloudSynced: true } : {}
          };
          if (bIdx >= 0) {
            branchesStore[bIdx] = stamped;
          } else {
            branchesStore.unshift(stamped);
          }
          branchesStore = normalizeAndDeduplicateHubBranches(branchesStore);
          scheduleSave();
          console.log(`[Termux Hub] \u{1F3E2} Synced Branch: ${stamped.name || stamped.branchName || resolvedId} (${resolvedId}) stamped at ${hubIso}`);
          try {
            ws.send(JSON.stringify({
              type: "SYNC_ACK",
              action: "SYNC_ACK",
              entityType: "BRANCH",
              id: bId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso
            }));
          } catch (e) {
          }
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "BRANCH", bId);
          const branchBroadcastStr = JSON.stringify({
            type: "BRANCH",
            action: "BRANCH_SYNC",
            branch: stamped,
            payload: stamped,
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: hubNow
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(branchBroadcastStr);
              } catch (e) {
              }
            }
          });
        }
      }
      const rawCashAccObj = packet.cashAccount || (payload && (payload.account_id || sheetName && sheetName.toLowerCase() === "cashaccounts") ? payload : null);
      const isCashAccount = pType === "CASH_ACCOUNT" || pType === "CASH_ACCOUNT_SYNC" || pType === "CASH_ACCOUNT_RECORD" || pType === "cash_account" || sheetName === "CashAccounts" || sheetName === "cash_accounts" || !!rawCashAccObj;
      if (isCashAccount && rawCashAccObj && (rawCashAccObj.account_id || rawCashAccObj.id)) {
        const accId = rawCashAccObj.account_id || rawCashAccObj.id;
        const hubNow = Date.now();
        const hubIso = (/* @__PURE__ */ new Date()).toISOString();
        const incomingTime = getTimestamp(rawCashAccObj) || getTimestamp(packet);
        if (isTombstoned(accId, "cash_account", incomingTime)) {
          const tomb = findHubTombstone(accId, "cash_account");
          console.log(`[Termux Hub] \u{1FAA6} Resurrection Blocked for tombstoned cash account #${accId}`);
          if (tomb) {
            try {
              ws.send(JSON.stringify({ type: "TOMBSTONE_SYNC", action: "TOMBSTONE_SYNC", entityType: "tombstone", tombstone: tomb, payload: tomb, origin_device_id: "LOCAL_HUB", timestamp: Date.now() }));
            } catch (e) {
            }
          }
          return;
        }
        const incAccComp = String(rawCashAccObj.company_id || rawCashAccObj.companyId || packet.company_id || packet.companyId || "").trim().toUpperCase();
        const aIdx = cashAccountsStore.findIndex((a) => {
          if ((a.account_id || a.id) !== accId) return false;
          const exComp = String(a.company_id || a.companyId || "").trim().toUpperCase();
          return !incAccComp || !exComp || exComp === incAccComp;
        });
        let accepted = true;
        if (aIdx >= 0) {
          const existing = cashAccountsStore[aIdx];
          const existingTime = getTimestamp(existing);
          if (existingTime > 0 && incomingTime > 0 && existingTime > incomingTime + 6e4) {
            console.log(
              `[Termux Hub] \u{1F6E1}\uFE0F LWW Reject: Stale cash account update for ${accId} (Hub: ${new Date(existingTime).toISOString()} > Incoming: ${new Date(incomingTime).toISOString()}). Sending authoritative Hub record back.`
            );
            try {
              ws.send(JSON.stringify({
                packetId: `HUB-CACC-FIX-${accId}-${hubNow}`,
                type: "CASH_ACCOUNT",
                action: "CASH_ACCOUNT_SYNC",
                entityType: "cash_account",
                companyId: existing.company_id || packet.companyId,
                branchId: existing.branch_id || packet.branchId,
                target_branch_id: existing.account_type === "HQ_SAFE" || existing.account_type === "BANK_ACCOUNT" || existing.branch_id === "HQ" ? "ALL" : existing.branch_id || packet.branchId || "BR-MAIN",
                cashAccount: existing,
                payload: existing,
                updatedAt: existingTime,
                hubTimestamp: existingTime,
                lastUpdated: existing.lastUpdated || new Date(existingTime).toISOString(),
                origin_device_id: "LOCAL_HUB",
                origin_device_name: "Termux Local Hub",
                timestamp: Date.now()
              }));
            } catch (e) {
            }
            accepted = false;
          }
        }
        if (accepted) {
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, rawCashAccObj);
          const prevAcc = aIdx >= 0 ? cashAccountsStore[aIdx] : null;
          const balanceChanged = !prevAcc || Math.abs((Number(rawCashAccObj.current_balance) || 0) - (Number(prevAcc.current_balance) || 0)) > 5e-3 || Math.abs((Number(rawCashAccObj.native_balance) || 0) - (Number(prevAcc.native_balance) || 0)) > 5e-3;
          const resolvedCloudSynced = incomingCloudSynced || !balanceChanged && Boolean(prevAcc && prevAcc.isCloudSynced === true);
          const isGlobalAcc = rawCashAccObj.account_type === "HQ_SAFE" || rawCashAccObj.account_type === "BANK_ACCOUNT" || String(rawCashAccObj.branch_id || "").toUpperCase().trim() === "HQ";
          const stamped = {
            ...prevAcc || {},
            ...rawCashAccObj,
            account_id: accId,
            id: accId,
            target_branch_id: isGlobalAcc ? "ALL" : rawCashAccObj.target_branch_id || rawCashAccObj.branch_id || prevAcc?.branch_id || "BR-MAIN",
            updatedAt: hubNow,
            hubTimestamp: hubNow,
            lastUpdated: hubIso,
            updated_at: hubIso,
            isCloudSynced: resolvedCloudSynced
          };
          if (aIdx >= 0) {
            cashAccountsStore[aIdx] = stamped;
          } else {
            cashAccountsStore.unshift(stamped);
          }
          scheduleSave();
          console.log(`[Termux Hub] \u{1F4B0} Synced Cash Account: ${stamped.account_name || accId} (${accId}) bal=$${Number(stamped.current_balance || 0).toFixed(2)} (cloudSynced=${resolvedCloudSynced})`);
          try {
            ws.send(JSON.stringify({
              type: "SYNC_ACK",
              action: "SYNC_ACK",
              entityType: "CASH_ACCOUNT",
              id: accId,
              updatedAt: hubNow,
              hubTimestamp: hubNow,
              lastUpdated: hubIso
            }));
          } catch (e) {
          }
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CASH_ACCOUNT", accId);
          const accBroadcastStr = JSON.stringify({
            packetId: `HUB-CACC-${accId}-${hubNow}`,
            type: "CASH_ACCOUNT",
            action: "CASH_ACCOUNT_SYNC",
            entityType: "cash_account",
            companyId: stamped.company_id || packet.companyId,
            branchId: stamped.branch_id || packet.branchId,
            target_branch_id: stamped.target_branch_id,
            cashAccount: stamped,
            payload: stamped,
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: hubNow
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(accBroadcastStr);
              } catch (e) {
              }
            }
          });
        }
        return;
      }
      const isEod = pType === "END_OF_DAY_COMPLETED" || pType === "BUSINESS_DAY_CLOSURE" || pType === "EOD_COMPLETED" || sheetName === "BusinessDayClosures";
      if (isEod) {
        const closure = packet.closure || payload || packet.data;
        if (closure && (closure.id || closure.date)) {
          const cId = closure.id || `EOD-${closure.date}`;
          const incomingCloudSynced = hasIncomingCloudSyncFlag(packet, closure);
          const exIdx = businessDayClosuresStore.findIndex((c) => c.id === cId || c.date === closure.date);
          const resolvedCloudSynced = incomingCloudSynced || exIdx >= 0 && businessDayClosuresStore[exIdx].isCloudSynced === true;
          if (exIdx >= 0) {
            businessDayClosuresStore[exIdx] = { ...businessDayClosuresStore[exIdx], ...closure, ...resolvedCloudSynced ? { isCloudSynced: true } : {} };
          } else {
            businessDayClosuresStore.unshift({ ...closure, ...resolvedCloudSynced ? { isCloudSynced: true } : {} });
          }
          scheduleSave();
          if (incomingCloudSynced) broadcastCloudSyncAck(ws, "CLOSURE", cId);
          console.log(`[Termux Hub] Recorded End of Day Closure for Date: ${closure.date} by ${closure.closedBySupervisorName || "Supervisor"}`);
        }
      }
      const isTombstone = pType === "TOMBSTONE_SYNC" || pType === "tombstone" || entityType === "tombstone";
      if (isTombstone) {
        const tombObj = packet.tombstone || payload || packet;
        if (tombObj && tombObj.entityId && tombObj.entityType) {
          const stampedTomb = recordAndPurgeHubTombstone(
            tombObj.entityType,
            tombObj.entityId,
            tombObj.deletedAt || Date.now(),
            tombObj
          );
          scheduleSave();
          console.log(`[Termux Hub] \u{1FAA6} Recorded Tombstone & purged ${stampedTomb.entityType} #${stampedTomb.entityId}`);
          const tombcast = JSON.stringify({
            type: "TOMBSTONE_SYNC",
            action: "TOMBSTONE_SYNC",
            entityType: "tombstone",
            tombstone: stampedTomb,
            payload: stampedTomb,
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: Date.now()
          });
          wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              try {
                client.send(tombcast);
              } catch (e) {
              }
            }
          });
          return;
        }
      }
      const isSnapReq = pType === "INVENTORY_SNAPSHOT_REQUEST" || pType === "GET_INVENTORY_SNAPSHOT";
      if (isSnapReq) {
        const reqComp = (packet.companyId || packet.company_id || "COMP-001").trim().toUpperCase();
        const reqBranch = (packet.branchId || packet.branchCode || "BR-MAIN").trim().toUpperCase();
        const items = inventoryStore.filter((i) => !isTombstoned(getTombstoneRecordId(i, "inventory_item"), "inventory_item", getTimestamp(i)) && isMatch(i, reqComp, reqBranch, true)).map((i) => ({
          ...i,
          totalUnits: Number(i.totalUnits || 0),
          stockSingles: Number(i.stockSingles !== void 0 ? i.stockSingles : i.totalUnits || 0),
          snapshotTimestamp: i.snapshotTimestamp || getTimestamp(i) || Date.now()
        }));
        const snapTombstones = tombstonesStore.filter(
          (t) => t && normalizeHubEntityType(t.entityType) === "inventory_item" && isMatch(t, reqComp, reqBranch, true)
        );
        try {
          ws.send(JSON.stringify({
            type: "INVENTORY_SNAPSHOT_RESPONSE",
            action: "INVENTORY_SNAPSHOT_RESPONSE",
            items,
            tombstones: snapTombstones,
            count: items.length,
            snapshotTimestamp: Date.now(),
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: Date.now()
          }));
          console.log(`[Termux Hub] \u{1F4F8} Dispatched full inventory snapshot (${items.length} items, ${snapTombstones.length} tombstones) to peer`);
        } catch (e) {
        }
        return;
      }
      const isHistoricalFetch = pType === "FETCH_HISTORICAL_T1" || pType === "GET_HISTORICAL_T1";
      if (isHistoricalFetch) {
        const reqComp = (packet.companyId || packet.company_id || "COMP-001").trim().toUpperCase();
        const reqBranch = (packet.branchId || packet.branchCode || "BR-MAIN").trim().toUpperCase();
        const targetEntity = String(packet.targetEntity || packet.entity || "sales").toLowerCase();
        const startDate = packet.startDate ? new Date(packet.startDate).getTime() : 0;
        const endDate = packet.endDate ? new Date(packet.endDate).getTime() : Date.now();
        let results = [];
        if (targetEntity.includes("sale")) {
          results = salesStore.filter((s) => isMatch(s, reqComp, reqBranch) && getTimestamp(s) >= startDate && getTimestamp(s) <= endDate);
        } else if (targetEntity.includes("grv")) {
          results = directGrvsStore.filter((g) => isMatch(g, reqComp, reqBranch) && getTimestamp(g) >= startDate && getTimestamp(g) <= endDate);
        } else if (targetEntity.includes("expense")) {
          results = expensesStore.filter((e) => isMatch(e, reqComp, reqBranch) && getTimestamp(e) >= startDate && getTimestamp(e) <= endDate);
        } else if (targetEntity.includes("cash")) {
          results = cashLogsStore.filter((c) => isMatch(c, reqComp, reqBranch) && getTimestamp(c) >= startDate && getTimestamp(c) <= endDate);
        }
        try {
          ws.send(JSON.stringify({
            type: "HISTORICAL_T1_RESPONSE",
            action: "HISTORICAL_T1_RESPONSE",
            requestId: packet.requestId || packet.packet_id,
            targetEntity,
            records: results,
            count: results.length,
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: Date.now()
          }));
          console.log(`[Termux Hub] \u{1F4DC} Dispatched ${results.length} historical ${targetEntity} records for query [${packet.startDate} -> ${packet.endDate}]`);
        } catch (e) {
        }
        return;
      }
      const isFinReportReq = pType === "GET_FINANCIAL_REPORT" || pType === "FINANCIAL_REPORT_REQUEST";
      if (isFinReportReq) {
        const reqComp = (packet.companyId || packet.company_id || "COMP-001").trim().toUpperCase();
        const reqBranch = (packet.branchId || packet.branchCode || "BR-MAIN").trim().toUpperCase();
        const startDate = packet.startDate ? new Date(packet.startDate).getTime() : 0;
        const endDate = packet.endDate ? new Date(packet.endDate).getTime() : Date.now();
        const filteredSales = salesStore.filter(
          (s) => isMatch(s, reqComp, reqBranch) && s.status !== "Voided" && getTimestamp(s) >= startDate && getTimestamp(s) <= endDate
        );
        const filteredExpenses = expensesStore.filter(
          (e) => isMatch(e, reqComp, reqBranch) && getTimestamp(e) >= startDate && getTimestamp(e) <= endDate
        );
        let totalRevenue = 0;
        let totalCogs = 0;
        let invoiceCount = filteredSales.length;
        for (const s of filteredSales) {
          totalRevenue += Number(s.total || s.total_amount || 0);
          if (Array.isArray(s.items)) {
            for (const it of s.items) {
              const qty = Number(it.quantity || 0);
              const cost = Number(it.costPrice || it.costPerUnit || 0);
              totalCogs += qty * cost;
            }
          }
        }
        let totalExpenses = 0;
        for (const exp of filteredExpenses) {
          totalExpenses += Number(exp.amount || 0);
        }
        const grossProfit = Number((totalRevenue - totalCogs).toFixed(2));
        const netProfit = Number((grossProfit - totalExpenses).toFixed(2));
        const grossMargin = totalRevenue > 0 ? Number((grossProfit / totalRevenue * 100).toFixed(2)) : 0;
        const netMargin = totalRevenue > 0 ? Number((netProfit / totalRevenue * 100).toFixed(2)) : 0;
        try {
          ws.send(JSON.stringify({
            type: "FINANCIAL_REPORT_RESPONSE",
            action: "FINANCIAL_REPORT_RESPONSE",
            requestId: packet.requestId || packet.packet_id,
            report: {
              startDate: packet.startDate,
              endDate: packet.endDate,
              invoiceCount,
              totalRevenue: Number(totalRevenue.toFixed(2)),
              totalCogs: Number(totalCogs.toFixed(2)),
              grossProfit,
              grossMarginPercentage: grossMargin,
              totalExpenses: Number(totalExpenses.toFixed(2)),
              netProfit,
              netMarginPercentage: netMargin,
              generatedAt: (/* @__PURE__ */ new Date()).toISOString()
            },
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: Date.now()
          }));
          console.log(`[Termux Hub] \u{1F4CA} Computed server-side financial report: Revenue=$${totalRevenue.toFixed(2)}, Net Profit=$${netProfit.toFixed(2)}`);
        } catch (e) {
        }
        return;
      }
      const isGenericQueryReq = pType === "QUERY_ENTITIES" || pType === "QUERY_ENTITIES_REQUEST";
      if (isGenericQueryReq) {
        const queryResult = queryHubEntities({
          entityType: packet.entityType || packet.entity || packet.targetEntity,
          companyId: packet.companyId || packet.company_id || hubTenantId,
          branchId: packet.branchId || packet.branch_id || packet.branchCode || "ALL",
          dateFrom: packet.dateFrom || packet.startDate,
          dateTo: packet.dateTo || packet.endDate,
          status: packet.status,
          limit: packet.limit
        });
        try {
          ws.send(JSON.stringify({
            type: "QUERY_ENTITIES_RESPONSE",
            action: "QUERY_ENTITIES_RESPONSE",
            requestId: packet.requestId || packet.packet_id,
            entityType: queryResult.entityType,
            records: queryResult.records,
            count: queryResult.count,
            totalMatched: queryResult.totalMatched,
            truncated: queryResult.truncated,
            hubTimestamp: Date.now(),
            origin_device_id: "LOCAL_HUB",
            origin_device_name: "Termux Local Hub",
            timestamp: Date.now()
          }));
          console.log(`[Termux Hub] \u{1F50E} QUERY_ENTITIES("${queryResult.entityType}") returned ${queryResult.count}/${queryResult.totalMatched} records`);
        } catch (e) {
        }
        return;
      }
      const isCatchupReq = pType === "catchup_request" || pType === "CATCHUP_REQUEST";
      if (isCatchupReq) {
        let sinceTime = 0;
        let sinceTimestamp = packet.sinceTimestamp;
        const isExplicitZero = sinceTimestamp === 0 || sinceTimestamp === "0" || sinceTimestamp === "1970-01-01T00:00:00.000Z" || sinceTimestamp === "1970-01-01T00:00:00Z";
        if (isExplicitZero || packet.isForced) {
          sinceTime = 0;
          sinceTimestamp = "1970-01-01T00:00:00.000Z";
        } else if (typeof sinceTimestamp === "number") {
          sinceTime = sinceTimestamp;
        } else if (typeof sinceTimestamp === "string") {
          const asNum = Number(sinceTimestamp);
          if (!isNaN(asNum) && asNum > 1e12) {
            sinceTime = asNum;
          } else {
            sinceTime = new Date(sinceTimestamp).getTime();
          }
        }
        if (isNaN(sinceTime) || sinceTime <= 0 && !isExplicitZero && !packet.isForced) {
          sinceTime = Date.now() - 5 * 60 * 1e3;
          sinceTimestamp = new Date(sinceTime).toISOString();
        } else if (!isExplicitZero) {
          sinceTimestamp = new Date(sinceTime).toISOString();
        }
        const reqDeviceId = packet.originDeviceId || "unknown";
        const reqComp = (packet.companyId || packet.company_id || "COMP-001").trim().toUpperCase();
        const reqBranch = (packet.branchId || packet.branchCode || "BR-MAIN").trim().toUpperCase();
        console.log(
          `[Termux Hub] \u{1F4E5} Received CATCHUP_REQUEST from ${reqDeviceId}: sinceTimestamp="${packet.sinceTimestamp}" parsed to sinceTime=${sinceTime} (${new Date(sinceTime).toISOString()}), isForced=${Boolean(packet.isForced)}`
        );
        const missedSales = salesStore.filter((s) => isMatch(s, reqComp, reqBranch) && (getTimestamp(s) >= sinceTime || packet.isForced || isExplicitZero));
        const missedDirectGrvs = directGrvsStore.filter((g) => isMatch(g, reqComp, reqBranch) && (getTimestamp(g) >= sinceTime || packet.isForced || isExplicitZero));
        const missedInventory = inventoryStore.filter((item) => !isTombstoned(item.itemId || item.id, "inventory_item", getTimestamp(item))).filter((i) => isMatch(i, reqComp, reqBranch, true) && (getTimestamp(i) >= sinceTime || packet.isForced || isExplicitZero));
        const isVaultCashLogRec = (c) => Boolean(
          c?.isVaultCustody || String(c?.staffId || "").toUpperCase().trim() === "VAULT_CUSTODY" || String(c?.branch_id || c?.branchId || "").toUpperCase().trim() === "HQ"
        );
        const missedCashLogs = deduplicateHubCashLogs(
          cashLogsStore.filter((c) => isMatch(c, reqComp, isVaultCashLogRec(c) ? "ALL" : reqBranch) && (getTimestamp(c) >= sinceTime || packet.isForced || isExplicitZero))
        );
        const missedCashLifts = cashLiftsStore.filter((l) => isMatch(l, reqComp, reqBranch) && (getTimestamp(l) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCashMovements = cashMovementsStore.filter((m) => isMatch(m, reqComp, reqBranch) && (getTimestamp(m) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCustomerChanges = customerChangesStore.filter((ch) => isMatch(ch, reqComp, reqBranch) && (getTimestamp(ch) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCreditSales = creditSalesStore.filter((cs) => isMatch(cs, reqComp, reqBranch) && (getTimestamp(cs) >= sinceTime || packet.isForced || isExplicitZero));
        const missedStockMovements = deduplicateHubStockMovements(
          stockMovementsStore.filter((sm) => isMatch(sm, reqComp, reqBranch) && (getTimestamp(sm) >= sinceTime || packet.isForced || isExplicitZero))
        );
        const missedExpenses = expensesStore.filter((ex) => isMatch(ex, reqComp, reqBranch) && (getTimestamp(ex) >= sinceTime || packet.isForced || isExplicitZero));
        const missedInternalConsumptions = internalConsumptionsStore.filter((ic) => isMatch(ic, reqComp, reqBranch) && (getTimestamp(ic) >= sinceTime || packet.isForced || isExplicitZero));
        const isGlobalCashTransferRec = (tr) => {
          const t = String(tr?.type || "").toUpperCase().trim();
          const b = String(tr?.branch_id || "").toUpperCase().trim();
          const tb = String(tr?.target_branch_id || "").toUpperCase().trim();
          return b === "HQ" || b === "ALL" || tb === "ALL" || t === "HQ_TO_BRANCH" || t === "BRANCH_TO_HQ" || t === "BANK_DEPOSIT" || t === "BANK_WITHDRAWAL" || t === "ELECTRONIC_SETTLEMENT" || t === "CAPITAL_INFUSION" || t === "SUPPLIER_PAYMENT" || t === "THIRD_PARTY_PAYOUT";
        };
        const missedCashTransfers = cashTransfersStore.filter((tr) => isMatch(tr, reqComp, isGlobalCashTransferRec(tr) ? "ALL" : reqBranch) && (getTimestamp(tr) >= sinceTime || packet.isForced || isExplicitZero));
        const missedSuppliers = suppliersStore.filter((item) => !isTombstoned(item.supplierId || item.SupplierID || item.id, "supplier", getTimestamp(item))).filter((s) => isMatch(s, reqComp, reqBranch) && (getTimestamp(s) >= sinceTime || packet.isForced || isExplicitZero));
        const missedAdminSales = adminSalesStore.filter((a) => isMatch(a, reqComp, reqBranch) && (getTimestamp(a) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCashCounts = cashCountsStore.filter((c) => isMatch(c, reqComp, reqBranch) && (getTimestamp(c) >= sinceTime || packet.isForced || isExplicitZero));
        const missedVouchers = vouchersStore.filter((v) => isMatch(v, reqComp, reqBranch) && (getTimestamp(v) >= sinceTime || packet.isForced || isExplicitZero));
        let isStaffExplicitZero = isExplicitZero;
        let staffSinceTime = sinceTime;
        if (packet.staffSinceTime !== void 0) {
          staffSinceTime = Number(packet.staffSinceTime) || 0;
          if (staffSinceTime === 0) isStaffExplicitZero = true;
        } else if (packet.staffSinceTimestamp === "1970-01-01T00:00:00.000Z") {
          staffSinceTime = 0;
          isStaffExplicitZero = true;
        }
        const missedSalespeople = salespeopleStore.filter((item) => !isTombstoned(item.id || item.staffId, "staff", getTimestamp(item))).filter((s) => isMatch(s, reqComp, "ALL") && (getTimestamp(s) >= staffSinceTime || packet.isForced || isExplicitZero || isStaffExplicitZero));
        const missedCustomers = customersStore.filter((item) => !isTombstoned(item.customerId || item.id, "customer", getTimestamp(item))).filter((c) => isMatch(c, reqComp, reqBranch) && (getTimestamp(c) >= sinceTime || packet.isForced || isExplicitZero));
        const missedBranches = branchesStore.filter((item) => !isTombstoned(canonicalizeHubBranchId(item.branchId || item.branch_id || item.id), "branch", getTimestamp(item))).filter((b) => isValidBranchRecord(b) && isMatch(b, reqComp, "ALL") && (getTimestamp(b) >= sinceTime || packet.isForced || isExplicitZero));
        const isGlobalCashAccRec = (a) => a?.account_type === "HQ_SAFE" || a?.account_type === "BANK_ACCOUNT" || String(a?.branch_id || "").toUpperCase().trim() === "HQ" || String(a?.target_branch_id || "").toUpperCase().trim() === "ALL";
        const missedCashAccounts = cashAccountsStore.filter((item) => !isTombstoned(item.account_id || item.id, "cash_account", getTimestamp(item))).filter((a) => isMatch(a, reqComp, isGlobalCashAccRec(a) ? "ALL" : reqBranch) && (getTimestamp(a) >= sinceTime || packet.isForced || isExplicitZero));
        const missedCasualWorkers = casualWorkersStore.filter((item) => !isTombstoned(item.id || item.pin_hash, "casual_worker", getTimestamp(item))).filter((item) => isMatch(item, reqComp, "ALL"));
        const missedCategories = categoriesStore.filter((item) => !isTombstoned(item.categoryId || item.id || item.categoryName, "inventory_category", getTimestamp(item))).filter((item) => isMatch(item, reqComp, "ALL"));
        const missedCreditGroups = creditGroupsStore.filter((item) => !isTombstoned(item.groupId || item.id, "credit_group", getTimestamp(item))).filter((item) => isMatch(item, reqComp, "ALL"));
        const missedStocktakeSessions = stocktakeSessionsStore.filter((item) => !isTombstoned(item.sessionId || item.id, "stocktake_session", getTimestamp(item))).filter((item) => isMatch(item, reqComp, reqBranch));
        const missedZoneAssignments = zoneAssignmentsStore.filter((item) => isMatch(item, reqComp, reqBranch));
        const missedBranchLockdowns = Object.values(branchLockdownsStore || {}).filter(
          (item) => item && isMatch(item, reqComp, reqBranch)
        );
        const missedBusinessDayClosures = businessDayClosuresStore.filter((item) => isMatch(item, reqComp, reqBranch));
        const missedElectronicSettlements = electronicSettlementsStore.filter(
          (item) => isMatch(item, reqComp, "ALL") && (getTimestamp(item) >= sinceTime || packet.isForced || isExplicitZero)
        );
        const missedStocktakeSegments = stocktakeSegmentsStore.filter((item) => isMatch(item, reqComp, reqBranch));
        const missedDailyBlindConfigs = dailyBlindConfigsStore.filter((item) => isMatch(item, reqComp, reqBranch));
        const missedDailyBlindCounts = dailyBlindCountsStore.filter(
          (item) => isMatch(item, reqComp, reqBranch) && (getTimestamp(item) >= sinceTime || packet.isForced || isExplicitZero)
        );
        const missedPurchaseOrders = purchaseOrdersStore.filter(
          (item) => isMatch(item, reqComp, reqBranch) && (getTimestamp(item) >= sinceTime || packet.isForced || isExplicitZero)
        );
        const missedSecurityAlerts = securityAlertsStore.filter((item) => isMatch(item, reqComp, "ALL")).slice(0, 50);
        const tombstoneWindowStart = Math.max(0, sinceTime - 5 * 60 * 1e3);
        const missedTombstones = tombstonesStore.filter((t) => {
          if (!t || !t.entityId) return false;
          const isCat = isCatalogTombstoneType(t.entityType);
          if (!isMatch(t, reqComp, reqBranch, isCat)) return false;
          if (packet.isForced || isExplicitZero) return true;
          const tombTs = Math.max(Number(t.hubTimestamp) || 0, Number(t.deletedAt) || 0, getTimestamp(t));
          return tombTs >= tombstoneWindowStart;
        });
        const missedGenericEnvelopes = [];
        for (const [gType, bucket] of Object.entries(genericEntitiesStore || {})) {
          if (!bucket || typeof bucket !== "object") continue;
          const isGlobalGen = isHubGlobalBranchEntityType(gType) || isCanonicalT2Type(gType);
          const isT2Gen = isCanonicalT2Type(gType);
          for (const [gId, rec] of Object.entries(bucket)) {
            if (!rec || typeof rec !== "object") continue;
            const recTs = Number(rec._updatedAt || getTimestamp(rec)) || 0;
            if (isT2Gen && isTombstoned(gId, gType, recTs)) continue;
            if (!isMatch(rec, reqComp, reqBranch, isGlobalGen)) continue;
            if (recTs >= sinceTime || packet.isForced || isExplicitZero) {
              missedGenericEnvelopes.push({
                packetId: `HUB-GEN-${gType}-${gId}-${recTs}`,
                entityType: gType,
                entityId: gId,
                action: "UPSERT",
                class: rec._class || (isT2Gen ? "T2" : "T1"),
                updatedAt: recTs || Date.now(),
                originDeviceId: "LOCAL_HUB",
                targetBranchId: isGlobalGen ? "ALL" : rec.branch_id || rec.branchId || reqBranch || "ALL",
                data: rec
              });
            }
          }
        }
        const catchupResponse = {
          type: "catchup_response",
          action: "CATCHUP_RESPONSE",
          packet_id: `CRS-HUB-${Date.now()}`,
          originDeviceId: "LOCAL_HUB",
          originDeviceName: "Termux Local Hub",
          targetDeviceId: reqDeviceId,
          sinceTimestamp,
          cutoffTimestamp: (/* @__PURE__ */ new Date()).toISOString(),
          isReciprocal: true,
          delta: {
            sales: missedSales,
            directGrvs: missedDirectGrvs,
            inventoryItems: missedInventory,
            cashLogs: missedCashLogs,
            cashLifts: missedCashLifts,
            cashMovements: missedCashMovements,
            customerChanges: missedCustomerChanges,
            creditSales: missedCreditSales,
            stockMovements: missedStockMovements,
            expenses: missedExpenses,
            internalConsumptions: missedInternalConsumptions,
            cashTransfers: missedCashTransfers,
            suppliers: missedSuppliers,
            adminSales: missedAdminSales,
            cashCounts: missedCashCounts,
            vouchers: missedVouchers,
            casualWorkers: missedCasualWorkers,
            zoneAssignments: missedZoneAssignments,
            branchLockdowns: missedBranchLockdowns,
            salespeople: missedSalespeople,
            customers: missedCustomers,
            branches: missedBranches,
            cashAccounts: missedCashAccounts,
            businessDayClosures: missedBusinessDayClosures,
            electronicSettlements: missedElectronicSettlements,
            categories: missedCategories,
            creditGroups: missedCreditGroups,
            stocktakeSessions: missedStocktakeSessions,
            stocktakeSegments: missedStocktakeSegments,
            dailyBlindConfigs: missedDailyBlindConfigs,
            dailyBlindCounts: missedDailyBlindCounts,
            purchaseOrders: missedPurchaseOrders,
            tombstones: missedTombstones,
            ...missedGenericEnvelopes.length > 0 ? { genericEnvelopes: missedGenericEnvelopes } : {},
            ...Array.isArray(permissionsMatrixStore.rules) && permissionsMatrixStore.rules.length > 0 && ((permissionsMatrixStore.updatedAt || 0) >= sinceTime || packet.isForced || isExplicitZero) ? { permissionsMatrix: permissionsMatrixStore } : {},
            ...roleConfigsStore.definitions && ((roleConfigsStore.updatedAt || 0) >= sinceTime || packet.isForced || isExplicitZero) ? { roleConfigs: roleConfigsStore } : {},
            ...multiCurrencyStore.config && ((multiCurrencyStore.updatedAt || 0) >= sinceTime || packet.isForced || isExplicitZero) ? { multiCurrencyConfig: multiCurrencyStore.config } : {},
            securityAlerts: missedSecurityAlerts
          }
        };
        try {
          ws.send(JSON.stringify(catchupResponse));
          console.log(
            `[Termux Hub] \u{1F4E4} Dispatched Delta Catch-up to ${reqDeviceId}: ${missedSales.length} sales, ${missedDirectGrvs.length} GRVs, ${missedInventory.length} inventory deltas (No Firehose), ${missedCashLogs.length} cash logs, ${missedSuppliers.length} suppliers, ${missedAdminSales.length} admin sales, ${missedCashCounts.length} cash counts, ${missedVouchers.length} vouchers, ${missedSalespeople.length} staff, ${missedCustomers.length} customers, ${categoriesStore.length} categories, ${missedTombstones.length} tombstones, ${missedGenericEnvelopes.length} generic envelopes.`
          );
        } catch (e) {
          console.warn("[Termux Hub] Failed to send catchup response:", e.message);
        }
        return;
      }
      const rawGenericEntityType = packet.entityType || (pType === "DB_MUTATION" ? packet.sheetName : "");
      const genericPayloadObj = packet.payload && typeof packet.payload === "object" ? packet.payload : packet.data && typeof packet.data === "object" ? packet.data : null;
      if (rawGenericEntityType && genericPayloadObj && pType !== "HEARTBEAT" && pType !== "PING" && pType !== "PONG" && pType !== "SYNC_RECEIPT" && pType !== "SYNC_ACK") {
        const canonGenType = mapHubEntityToCanonicalType(rawGenericEntityType);
        const genId = String(packet.entityId || packet.recordId || getHubCanonicalEntityId(genericPayloadObj, canonGenType) || "").trim();
        if (canonGenType && genId && canonGenType !== "sheet_mutation" && canonGenType !== "sync_receipt") {
          const alreadyCloud = hasIncomingCloudSyncFlag(packet, genericPayloadObj);
          const storedOk = upsertGenericEntityInHub(canonGenType, genId, genericPayloadObj, {
            updatedAt: packet.updatedAt || packet.timestamp || Date.now(),
            class: packet.class,
            isCloudSynced: alreadyCloud
          });
          if (storedOk) {
            scheduleSave();
            if (!alreadyCloud) {
              pushToCloud(canonGenType, genericEntitiesStore[canonGenType][genId]);
            }
          }
        }
      }
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN && client.isAuthenticated !== false) {
          try {
            client.send(dataStr);
          } catch (e) {
          }
        }
      });
    } catch (err) {
      console.error("[Termux Hub] Error processing message:", err.message);
    }
  });
  ws.on("close", () => {
    for (const [devId, pending] of pendingPairRequests.entries()) {
      if (pending.ws === ws) {
        pendingPairRequests.delete(devId);
      }
    }
    console.log(`[Termux Hub] \u{1F534} POS Terminal disconnected`);
  });
  ws.on("error", (err) => {
    console.warn("[Termux Hub] Client WebSocket error:", err.message);
  });
});
server.listen(PORT, "0.0.0.0", () => {
  console.log(`================================================================`);
  console.log(`\u{1F680} Saimetric POS - Universal Freeze-Once Local Hub (v${HUB_VERSION})`);
  console.log(`\u{1F4E1} WebSocket URL:  ws://0.0.0.0:${PORT}`);
  console.log(`\u{1F310} HTTP Status:    http://0.0.0.0:${PORT}/health`);
  console.log(`\u{1F194} Hub ID:         ${hubSecurityState.hubId} (${HUB_RUNTIME} / Slot ${HUB_OTA_SLOT})`);
  console.log(`\u{1F510} Mutual Auth:    ${HUB_REQUIRE_AUTH ? "STRICT (Paired Devices Only)" : "OPTIONAL (Termux Backup Mode \u2014 pass --require-auth to enforce)"}`);
  console.log(`\u{1F3E2} Branch ID:      ${hubBranchId} ("${hubBranchName}")`);
  console.log(`\u{1F3E2} Tenant ID:      ${hubTenantId}`);
  console.log(`\u{1F4BE} Data File:      ${DATA_FILE}`);
  console.log(`\u26A1 Dual-Sync:      Transactional (Append-Only) & Config (Strict LWW)`);
  console.log(`\u{1F6E1}\uFE0F  Staff LWW handler registered (v3.4.0)`);
  console.log(`\u{1F6E1}\uFE0F  Customer LWW handler registered (v3.4.0)`);
  console.log(`\u{1F6E1}\uFE0F  Branch LWW handler registered (v3.4.0)`);
  console.log(`\u{1F6E1}\uFE0F  Casual Workers LWW handler registered (v3.4.0)`);
  console.log(`\u{1F6E1}\uFE0F  Stocktake Session LWW handler registered (v3.4.0)`);
  console.log(`\u{1F6E1}\uFE0F  Cash Account LWW handler registered (v3.4.0)`);
  console.log(`\u{1F4E6} Supplier sync registered (v3.5.0)`);
  console.log(`\u{1F4E6} Admin Sales sync registered (v3.5.0)`);
  console.log(`\u{1F4E6} Cash Count sync registered (v3.5.0)`);
  console.log(`\u{1F4E6} Voucher sync registered (v3.5.0)`);
  console.log(`\u{1F4E6} Closures & Settlements sync registered (v3.6.0)`);
  console.log(`\u{1F4E6} Categories sync registered (v3.6.0)`);
  console.log(`\u{1F9F9} Automated Reconciliation Sweep Engine active (30m interval + connection trigger)`);
  console.log(`\u2601\uFE0F  Edge-to-Cloud (Hub to Supabase) Bridge active (v3.7.0)`);
  console.log(`================================================================`);
});
var RECON_SWEEP_INTERVAL_MS = 30 * 60 * 1e3;
setInterval(() => {
  triggerAllClientsReconSweep();
}, RECON_SWEEP_INTERVAL_MS);
async function syncEdgeToCloudSupabase() {
  const adapterCfg = resolveCloudAdapterConfig();
  if (adapterCfg.databaseType === "none") {
    return;
  }
  const tablesToSync = [
    { name: "sales", entityType: "sales", isT2: false, store: salesStore },
    { name: "customer_changes", entityType: "customer_changes", isT2: false, store: customerChangesStore },
    { name: "credit_sales", entityType: "credit_sales", isT2: false, store: creditSalesStore },
    { name: "cash_logs", entityType: "cash_logs", isT2: false, store: cashLogsStore },
    { name: "stock_movements", entityType: "stock_movements", isT2: false, store: stockMovementsStore },
    { name: "direct_grvs", entityType: "direct_grvs", isT2: false, store: directGrvsStore },
    { name: "expenses", entityType: "expenses", isT2: false, store: expensesStore },
    { name: "inventory", entityType: "inventory", isT2: true, store: inventoryStore },
    { name: "customers", entityType: "customers", isT2: true, store: customersStore },
    { name: "staff", entityType: "staff", isT2: true, store: salespeopleStore }
  ];
  if (adapterCfg.databaseType === "mongodb") {
    const mongoUri = String(adapterCfg.credentials.mongoUri || adapterCfg.credentials.uri || "").trim();
    if (!mongoUri) return;
    try {
      const { MongoClient } = require("mongodb");
      const client = new MongoClient(mongoUri);
      await client.connect();
      const db = client.db(adapterCfg.credentials.database || "saimetric_pos");
      for (const t of tablesToSync) {
        const unsynced = t.store.filter((r) => r && r.isCloudSynced !== true).slice(0, 50);
        for (const rec of unsynced) {
          const recId = String(getEntityId(rec, t.entityType) || "");
          if (!recId) continue;
          await db.collection(t.name).updateOne({ id: recId }, { $set: rec }, { upsert: true });
          rec.isCloudSynced = true;
        }
      }
      await client.close();
      lastCloudSyncTimestamp = Date.now();
      scheduleSave();
    } catch (err) {
      console.warn("[Edge-to-Cloud] MongoDB adapter notice:", err.message);
    }
    return;
  }
  if (adapterCfg.useUnifiedGateway) {
    if (cloudBackoffUntil > Date.now()) {
      return;
    }
    const target = resolveUnifiedGatewayTarget(adapterCfg);
    const targetUrl = target.url;
    if (!targetUrl) return;
    await fetchCloudGatewayPolicy(targetUrl);
    const getTrRankHub = (st) => {
      const u = String(st || "").toUpperCase().trim();
      if (u === "DRAFT") return 0;
      if (u === "PENDING_APPROVAL" || u === "PENDING_ACCEPTANCE") return 1;
      if (u === "IN_TRANSIT") return 2;
      if (u === "APPROVED") return 3;
      if (u === "RECEIVED" || u === "COMPLETED" || u === "RETURNED" || u === "CANCELLED" || u === "REJECTED") return 4;
      return 0;
    };
    const mergeStocktakeSessionHub = (existing, incoming) => {
      const exItems = Array.isArray(existing?.consolidatedItems) ? existing.consolidatedItems : [];
      const incItems = Array.isArray(incoming?.consolidatedItems) ? incoming.consolidatedItems : [];
      const pauseMap = /* @__PURE__ */ new Map();
      [...Array.isArray(existing?.pauseHistory) ? existing.pauseHistory : [], ...Array.isArray(incoming?.pauseHistory) ? incoming.pauseHistory : []].forEach((p) => {
        if (!p || !p.pausedAt) return;
        const prev = pauseMap.get(p.pausedAt);
        pauseMap.set(p.pausedAt, prev ? { ...prev, ...p } : p);
      });
      const mergedPauseHistory = Array.from(pauseMap.values()).sort(
        (a, b) => new Date(a.pausedAt).getTime() - new Date(b.pausedAt).getTime()
      );
      const baseMerged = {
        ...existing,
        ...incoming,
        ...mergedPauseHistory.length > 0 ? { pauseHistory: mergedPauseHistory } : {},
        isCloudSynced: true
      };
      if (incItems.length === 0) return baseMerged;
      const exMap = /* @__PURE__ */ new Map();
      exItems.forEach((ci) => {
        if (ci && ci.itemId) exMap.set(String(ci.itemId).toUpperCase(), ci);
      });
      const mergedItems = incItems.map((inc) => {
        const ex = exMap.get(String(inc.itemId || "").toUpperCase());
        if (!ex) return inc;
        const cMap = /* @__PURE__ */ new Map();
        (Array.isArray(ex.varianceComments) ? ex.varianceComments : []).forEach((c) => {
          if (c && c.id) cMap.set(c.id, c);
        });
        (Array.isArray(inc.varianceComments) ? inc.varianceComments : []).forEach((c) => {
          if (c && c.id) cMap.set(c.id, c);
        });
        const mergedComments = Array.from(cMap.values()).sort(
          (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
        );
        return {
          ...ex,
          ...inc,
          ...mergedComments.length > 0 ? { varianceComments: mergedComments } : {}
        };
      });
      return { ...baseMerged, consolidatedItems: mergedItems };
    };
    const ingestCloudEnvelopeIntoHub = (env) => {
      if (!env || !env.entityType || !env.data || typeof env.data !== "object") return false;
      const eType = mapHubEntityToCanonicalType(env.entityType);
      const rawNorm = normalizeIncomingCloudRecord(eType, env.data, env.entityId);
      const rec = { ...rawNorm, isCloudSynced: true };
      const cId = String(getHubCanonicalEntityId(rec, eType) || env.entityId || "").trim();
      if (!cId) return false;
      if (eType === "inventory_item" && /^USR-/i.test(cId)) return false;
      const cloudTs = parseHubTimestampMs(env.updatedAt || rec.updatedAt || rec.lastUpdated || rec.hubTimestamp) || Date.now();
      if (eType === "tombstone") {
        const tTargetType = normalizeHubEntityType(rec.entityType || "");
        const tTargetId = String(rec.entityId || cId).trim();
        const delAt = parseHubTimestampMs(rec.deletedAt || cloudTs) || Date.now();
        if (tTargetId) {
          recordAndPurgeHubTombstone(tTargetType, tTargetId, delAt, { ...rec, isCloudSynced: true });
          return true;
        }
        return false;
      }
      if (T2_CANONICAL_TYPES.has(eType) && cId && isTombstoned(cId, eType, cloudTs)) {
        return false;
      }
      if (eType === "permissions_matrix") {
        const exTs2 = Number(permissionsMatrixStore.updatedAt) || 0;
        if (exTs2 > 0 && exTs2 > cloudTs + 6e4) return false;
        const rules = Array.isArray(rec.rules) ? rec.rules : permissionsMatrixStore.rules;
        permissionsMatrixStore = { rules, updatedAt: cloudTs, isCloudSynced: true };
        return true;
      }
      if (eType === "role_configs") {
        const exTs2 = Number(roleConfigsStore.updatedAt) || 0;
        if (exTs2 > 0 && exTs2 > cloudTs + 6e4) return false;
        const defs = rec.definitions || rec;
        roleConfigsStore = { definitions: defs, updatedAt: cloudTs, isCloudSynced: true };
        return true;
      }
      if (eType === "multi_currency") {
        const exTs2 = Number(multiCurrencyStore.updatedAt) || 0;
        if (exTs2 > 0 && (cloudTs === 0 || exTs2 > cloudTs + 6e4)) return false;
        multiCurrencyStore = { config: rec, updatedAt: cloudTs };
        return true;
      }
      if (eType === "branch_lockdown") {
        const brKey = String(rec.branchId || rec.branch_id || cId || hubBranchId).trim().toUpperCase();
        const ex2 = branchLockdownsStore[brKey] || branchLockdownsStore[rec.branchId || rec.branch_id || hubBranchId];
        const exTs2 = ex2 ? getRecordTimestamp(ex2) : 0;
        const ACTIVE_LOCK_STATUSES = /* @__PURE__ */ new Set([
          "ACTIVE",
          "IN_PROGRESS",
          "COUNTING",
          "PAUSED",
          "RECOUNT",
          "RECOUNTING",
          "AUDIT_REVIEW",
          "CONSOLIDATED",
          "PENDING_SIGNOFF",
          "READY_FOR_COMMITTAL"
        ]);
        const activeSessForBr = stocktakeSessionsStore.find((s) => {
          if (!s || !s.sessionId) return false;
          if (isTombstoned(s.sessionId, "stocktake_session", getTimestamp(s))) return false;
          const sBr = String(s.branchId || hubBranchId || "").trim().toUpperCase();
          return (!brKey || !sBr || sBr === brKey) && ACTIVE_LOCK_STATUSES.has(String(s.status || "").toUpperCase());
        });
        const incSessId = String(rec.sessionId || "").trim().toUpperCase();
        const actSessId = activeSessForBr ? String(activeSessForBr.sessionId || "").trim().toUpperCase() : "";
        if (actSessId && incSessId && incSessId !== actSessId) {
          return false;
        }
        if (ex2 && exTs2 > 0 && exTs2 > cloudTs + 6e4) return false;
        branchLockdownsStore[rec.branchId || brKey] = { ...rec, isCloudSynced: true };
        return true;
      }
      if (eType === "cash_log") {
        upsertHubCashLog(rec, true);
        return true;
      }
      const storeByType = {
        sale: { arr: salesStore, keyFn: (r) => r.id || r.invoice_id || r.InvoiceID },
        customer_change: { arr: customerChangesStore, keyFn: (r) => r.id || r.changeId },
        credit_sale: { arr: creditSalesStore, keyFn: (r) => r.id || r.creditId },
        cash_lift: { arr: cashLiftsStore, keyFn: (r) => r.id },
        cash_movement: { arr: cashMovementsStore, keyFn: (r) => r.id },
        cash_transfer: { arr: cashTransfersStore, keyFn: (r) => r.transfer_id || r.id },
        direct_grv: { arr: directGrvsStore, keyFn: (r) => r.id || r.grvNumber || r.grvId },
        expense: { arr: expensesStore, keyFn: (r) => r.id },
        internal_consumption: { arr: internalConsumptionsStore, keyFn: (r) => r.id },
        stock_movement: { arr: stockMovementsStore, keyFn: (r) => r.id || r.movementId || r.txnId },
        admin_sale: { arr: adminSalesStore, keyFn: (r) => r.id || r.invoice_id },
        cash_count: { arr: cashCountsStore, keyFn: (r) => r.id || r.countId },
        supplier_invoice_voucher: { arr: vouchersStore, keyFn: (r) => r.id || r.voucherNumber || r.voucherId },
        business_day_closure: { arr: businessDayClosuresStore, keyFn: (r) => r.id || r.closureId },
        electronic_settlement: { arr: electronicSettlementsStore, keyFn: (r) => r.id || r.settlementId },
        inventory_item: { arr: inventoryStore, keyFn: (r) => r.itemId || r.id || r.ItemID },
        customer: { arr: customersStore, keyFn: (r) => r.customerId || r.id },
        credit_group: { arr: creditGroupsStore, keyFn: (r) => r.groupId || r.id },
        supplier: { arr: suppliersStore, keyFn: (r) => r.supplierId || r.SupplierID || r.id },
        inventory_category: { arr: categoriesStore, keyFn: (r) => r.categoryId || r.id || r.categoryName },
        staff: { arr: salespeopleStore, keyFn: (r) => r.id || r.staffId },
        branch: { arr: branchesStore, keyFn: (r) => canonicalizeHubBranchId(r.branchId || r.branch_id || r.id) },
        cash_account: { arr: cashAccountsStore, keyFn: (r) => r.account_id || r.id },
        casual_worker: { arr: casualWorkersStore, keyFn: (r) => r.id || r.pin_hash },
        stocktake_session: { arr: stocktakeSessionsStore, keyFn: (r) => r.sessionId || r.id },
        stocktake_segment: { arr: stocktakeSegmentsStore, keyFn: (r) => r.segmentId || r.id },
        stocktake_zone_assignment: { arr: zoneAssignmentsStore, keyFn: (r) => r.id || `${r.sessionId || ""}::${r.zoneId || ""}` },
        daily_blind_config: { arr: dailyBlindConfigsStore, keyFn: (r) => r.id || r.configId },
        daily_blind_count: { arr: dailyBlindCountsStore, keyFn: (r) => r.id || r.countId },
        purchase_order: { arr: purchaseOrdersStore, keyFn: (r) => r.id || r.poNumber }
      };
      const targetSpec = storeByType[eType];
      if (!targetSpec) {
        return upsertGenericEntityInHub(eType, cId, rec, {
          updatedAt: cloudTs,
          class: env.class,
          isCloudSynced: true
        });
      }
      if (eType === "branch" && !isValidBranchRecord(rec)) return false;
      if (eType === "staff") {
        if ("pin" in rec) delete rec.pin;
        if ("rawPin" in rec) delete rec.rawPin;
        if ("password" in rec) delete rec.password;
        if (!isValidStaffRecord(rec)) return false;
      }
      if (eType === "customer" && !isValidCustomerRecord(rec)) return false;
      const idx = targetSpec.arr.findIndex((item) => String(targetSpec.keyFn(item) || "").trim().toUpperCase() === cId.toUpperCase());
      if (!T2_CANONICAL_TYPES.has(eType)) {
        if (idx === -1) {
          targetSpec.arr.unshift(rec);
          return true;
        }
        const ex2 = targetSpec.arr[idx];
        if (eType === "sale") {
          const exVoid = ex2.status === "Voided" || ex2.status === "Refunded";
          const incCompleted = rec.status !== "Voided" && rec.status !== "Refunded";
          if (exVoid && incCompleted) return false;
          if (rec.status !== ex2.status || rec.mobileVerificationStatus !== ex2.mobileVerificationStatus) {
            targetSpec.arr[idx] = { ...ex2, ...rec, isCloudSynced: true };
            return true;
          }
        } else if (eType === "cash_transfer") {
          const exRank = getTrRankHub(ex2.status);
          const incRank = getTrRankHub(rec.status);
          if (incRank > exRank || incRank === exRank && cloudTs > getRecordTimestamp(ex2)) {
            const linked = Array.from(/* @__PURE__ */ new Set([...ex2.linked_cash_log_ids || [], ...rec.linked_cash_log_ids || []]));
            targetSpec.arr[idx] = { ...ex2, ...rec, ...linked.length > 0 ? { linked_cash_log_ids: linked } : {}, isCloudSynced: true };
            return true;
          }
        } else if (eType === "credit_sale" || eType === "expense" || eType === "internal_consumption" || eType === "direct_grv") {
          if (cloudTs > getRecordTimestamp(ex2) && rec.status !== ex2.status) {
            targetSpec.arr[idx] = { ...ex2, ...rec, isCloudSynced: true };
            return true;
          }
        } else if (eType === "electronic_settlement") {
          if (cloudTs > getRecordTimestamp(ex2)) {
            targetSpec.arr[idx] = { ...ex2, ...rec, isCloudSynced: true };
            return true;
          }
        }
        return false;
      }
      if (idx === -1) {
        if (eType === "branch") {
          const normId = canonicalizeHubBranchId(cId);
          rec.id = normId;
          rec.branchId = normId;
        }
        targetSpec.arr.push(rec);
        return true;
      }
      const ex = targetSpec.arr[idx];
      const exTs = getRecordTimestamp(ex);
      if (exTs > 0 && (cloudTs === 0 || exTs > cloudTs + 6e4)) {
        return false;
      }
      if (eType === "staff") {
        const exPinVer = Number(ex.pinVersion || 0);
        const incPinVer = Number(rec.pinVersion || 0);
        const exPinTs = parseHubTimestampMs(ex.pinUpdatedAt) || exTs;
        const incPinTs = parseHubTimestampMs(rec.pinUpdatedAt) || cloudTs;
        if (ex.pin_hash && (!rec.pin_hash || exPinVer > incPinVer && incPinVer === 0 || exPinVer > incPinVer || exPinTs > incPinTs + 5e3)) {
          rec.pin_hash = ex.pin_hash;
          if (ex.pin_salt) rec.pin_salt = ex.pin_salt;
          rec.pinVersion = exPinVer;
          if (ex.pinUpdatedAt) rec.pinUpdatedAt = ex.pinUpdatedAt;
        }
        targetSpec.arr[idx] = { ...ex, ...rec, isCloudSynced: true };
        return true;
      }
      if (eType === "branch") {
        const normId = canonicalizeHubBranchId(ex.branchId || cId);
        const nextName = isHubPlaceholderBranchName(rec.name) && !isHubPlaceholderBranchName(ex.name) ? ex.name : rec.name;
        const nextCode = isHubPlaceholderBranchCode(rec.code, normId) && !isHubPlaceholderBranchCode(ex.code, normId) ? ex.code : rec.code;
        targetSpec.arr[idx] = { ...ex, ...rec, id: normId, branchId: normId, name: nextName, code: nextCode, isCloudSynced: true };
        return true;
      }
      if (eType === "stocktake_session") {
        targetSpec.arr[idx] = mergeStocktakeSessionHub(ex, rec);
        return true;
      }
      targetSpec.arr[idx] = { ...ex, ...rec, isCloudSynced: true };
      return true;
    };
    const newlyPulledEnvelopes = [];
    const authFields = getHubCloudAuthFields();
    let pullSucceeded = false;
    try {
      let cursor = 0;
      let page = 0;
      let maxSeq = lastAppsScriptServerSeq;
      const effectiveSinceSeq = lastAppsScriptServerSeq > 0 ? lastAppsScriptServerSeq : 0;
      const effectiveSinceTs = lastAppsScriptServerSeq > 0 ? lastCloudSyncTimestamp : 0;
      const MAX_PAGES = Number(hubRuntimePolicy.pullMaxPages) || 12;
      while (cursor !== null && page < MAX_PAGES) {
        if (cloudBackoffUntil > Date.now()) break;
        const pullRes = await postAppsScriptJson(targetUrl, {
          action: "pull_catchup",
          company_id: hubTenantId,
          branch_id: hubBranchId || "ALL",
          user_role: "OWNER",
          ...authFields,
          ...target.extraGatewayFields,
          since_seq: effectiveSinceSeq,
          since_ts: effectiveSinceTs,
          limit: 250,
          cursor
        });
        if (!pullRes.ok || !pullRes.json) break;
        if (pullRes.json.policy && typeof pullRes.json.policy === "object") {
          applyHubRuntimePolicy(pullRes.json.policy);
        }
        if (pullRes.json.success === false || pullRes.json.status === "error" || typeof pullRes.json.httpStatus === "number" && pullRes.json.httpStatus >= 400) {
          handleHubAppsScriptErrorResponse(pullRes.json);
          break;
        }
        pullSucceeded = true;
        if (typeof pullRes.json.current_routing_epoch === "number" && pullRes.json.current_routing_epoch > cloudRoutingEpoch) {
          cloudRoutingEpoch = pullRes.json.current_routing_epoch;
        }
        const list = Array.isArray(pullRes.json.envelopes) ? pullRes.json.envelopes : [];
        list.sort((a, b) => {
          if (a?.entityType === "tombstone" && b?.entityType !== "tombstone") return -1;
          if (b?.entityType === "tombstone" && a?.entityType !== "tombstone") return 1;
          return Number(a?.serverSeq || 0) - Number(b?.serverSeq || 0);
        });
        for (const rawEnv of list) {
          if (ingestCloudEnvelopeIntoHub(rawEnv)) {
            newlyPulledEnvelopes.push(rawEnv);
          }
          if (typeof rawEnv?.serverSeq === "number" && rawEnv.serverSeq > maxSeq) {
            maxSeq = rawEnv.serverSeq;
          }
        }
        if (typeof pullRes.json.server_seq === "number" && pullRes.json.server_seq > maxSeq) {
          maxSeq = pullRes.json.server_seq;
        }
        cursor = pullRes.json.hasMore && pullRes.json.nextCursor !== void 0 && pullRes.json.nextCursor !== null ? Number(pullRes.json.nextCursor) : null;
        page++;
      }
      if (maxSeq > lastAppsScriptServerSeq) {
        lastAppsScriptServerSeq = maxSeq;
      }
    } catch (pullErr) {
      console.warn("[Edge-to-Cloud] Cloud pull_catchup notice:", pullErr.message);
    }
    const canPushToTarget = !(adapterCfg.databaseType === "appscripts" && isBlockedMasterSheetWrite(hubTenantId, authFields.spreadsheet_id));
    if (!canPushToTarget) {
      console.warn(`[Edge-to-Cloud] \u{1F6E1}\uFE0F Skipping push_envelopes for non-master tenant ${hubTenantId}: dedicated spreadsheet_id required.`);
    }
    const pushSources = [
      { hubType: "TOMBSTONE", store: tombstonesStore },
      { hubType: "SALE", store: salesStore },
      { hubType: "CUSTOMER_CHANGE", store: customerChangesStore },
      { hubType: "CREDIT_SALE", store: creditSalesStore },
      { hubType: "CREDIT_GROUP", store: creditGroupsStore },
      { hubType: "CASH_LOG", store: cashLogsStore },
      { hubType: "CASH_LIFT", store: cashLiftsStore },
      { hubType: "CASH_MOVEMENT", store: cashMovementsStore },
      { hubType: "CASH_ACCOUNT", store: cashAccountsStore },
      { hubType: "CASH_TRANSFER", store: cashTransfersStore },
      { hubType: "GRV", store: directGrvsStore },
      { hubType: "EXPENSE", store: expensesStore },
      { hubType: "INTERNAL_CONSUMPTION", store: internalConsumptionsStore },
      { hubType: "STOCK_MOVEMENT", store: stockMovementsStore },
      { hubType: "ADMIN_SALE", store: adminSalesStore },
      { hubType: "CASH_COUNT", store: cashCountsStore },
      { hubType: "VOUCHER", store: vouchersStore },
      { hubType: "BUSINESS_DAY_CLOSURE", store: businessDayClosuresStore },
      { hubType: "ELECTRONIC_SETTLEMENT", store: electronicSettlementsStore },
      { hubType: "SUPPLIER", store: suppliersStore },
      { hubType: "CATEGORY", store: categoriesStore },
      { hubType: "CASUAL_WORKER", store: casualWorkersStore },
      { hubType: "STOCKTAKE_SESSION", store: stocktakeSessionsStore },
      { hubType: "STOCKTAKE_SEGMENT", store: stocktakeSegmentsStore },
      { hubType: "STOCKTAKE_ZONE_ASSIGNMENT", store: zoneAssignmentsStore },
      { hubType: "DAILY_BLIND_CONFIG", store: dailyBlindConfigsStore },
      { hubType: "DAILY_BLIND_COUNT", store: dailyBlindCountsStore },
      { hubType: "PURCHASE_ORDER", store: purchaseOrdersStore },
      { hubType: "INVENTORY", store: inventoryStore },
      { hubType: "CUSTOMER", store: customersStore },
      { hubType: "STAFF", store: salespeopleStore },
      { hubType: "BRANCH", store: branchesStore },
      { hubType: "BRANCH_LOCKDOWN", store: Object.values(branchLockdownsStore || {}) }
    ];
    const pendingPushPairs = [];
    if (canPushToTarget) {
      for (const src of pushSources) {
        for (const rec of src.store) {
          if (!rec || typeof rec !== "object" || rec.isCloudSynced === true) continue;
          const env = buildHubSyncEnvelope(src.hubType, rec);
          if (!env.entityId) continue;
          pendingPushPairs.push({ rec, env, hubType: src.hubType });
        }
      }
      for (const [gType, bucket] of Object.entries(genericEntitiesStore || {})) {
        if (!bucket || typeof bucket !== "object") continue;
        for (const rec of Object.values(bucket)) {
          if (!rec || typeof rec !== "object" || rec.isCloudSynced === true) continue;
          const env = buildHubSyncEnvelope(gType, rec);
          if (!env.entityId) continue;
          pendingPushPairs.push({ rec, env, hubType: gType.toUpperCase() });
        }
      }
      if (Array.isArray(permissionsMatrixStore.rules) && permissionsMatrixStore.rules.length > 0 && permissionsMatrixStore.isCloudSynced !== true) {
        pendingPushPairs.push({ rec: permissionsMatrixStore, env: buildHubSyncEnvelope("PERMISSIONS_MATRIX", permissionsMatrixStore), hubType: "PERMISSIONS_MATRIX" });
      }
      if (roleConfigsStore.definitions && roleConfigsStore.isCloudSynced !== true) {
        pendingPushPairs.push({ rec: roleConfigsStore, env: buildHubSyncEnvelope("ROLE_CONFIGS", roleConfigsStore), hubType: "ROLE_CONFIGS" });
      }
      if (multiCurrencyStore.config && multiCurrencyStore.config.isCloudSynced !== true) {
        pendingPushPairs.push({ rec: multiCurrencyStore.config, env: buildHubSyncEnvelope("MULTI_CURRENCY", multiCurrencyStore.config), hubType: "MULTI_CURRENCY" });
      }
    }
    const PUSH_BATCH = Number(hubRuntimePolicy.pushBatchSize) || 20;
    for (let i = 0; i < pendingPushPairs.length; i += PUSH_BATCH) {
      if (cloudBackoffUntil > Date.now()) break;
      const chunk = pendingPushPairs.slice(i, i + PUSH_BATCH);
      try {
        const pushRes = await postAppsScriptJson(targetUrl, {
          action: "push_envelopes",
          company_id: hubTenantId,
          branch_id: hubBranchId,
          user_id: `HUB-${hubBranchId}`,
          user_role: "OWNER",
          user_branch_id: hubBranchId,
          ...authFields,
          ...target.extraGatewayFields,
          envelopes: chunk.map((c) => c.env),
          timestamp: Date.now()
        });
        if (pushRes.ok && pushRes.json && pushRes.json.policy && typeof pushRes.json.policy === "object") {
          applyHubRuntimePolicy(pushRes.json.policy);
        }
        if (pushRes.ok && pushRes.json && (pushRes.json.success === false || pushRes.json.status === "error" || typeof pushRes.json.httpStatus === "number" && pushRes.json.httpStatus >= 400)) {
          handleHubAppsScriptErrorResponse(pushRes.json);
          break;
        }
        if (pushRes.ok && pushRes.json && pushRes.json.success !== false) {
          if (typeof pushRes.json.current_routing_epoch === "number" && pushRes.json.current_routing_epoch > cloudRoutingEpoch) {
            cloudRoutingEpoch = pushRes.json.current_routing_epoch;
          }
          const ackedSet = new Set(Array.isArray(pushRes.json.ackedPacketIds) ? pushRes.json.ackedPacketIds.map(String) : []);
          const flaggedSet = new Set(Array.isArray(pushRes.json.flaggedBackdateIds) ? pushRes.json.flaggedBackdateIds.map(String) : []);
          const failedMap = /* @__PURE__ */ new Map();
          if (Array.isArray(pushRes.json.failed)) {
            for (const f of pushRes.json.failed) {
              if (f && f.packetId) failedMap.set(String(f.packetId), String(f.error || "FAILED"));
            }
          }
          const srvIso = pushRes.json.server_received_at || (/* @__PURE__ */ new Date()).toISOString();
          let cloudWinningSession = null;
          let cloudWinningLockdown = null;
          if (Array.isArray(pushRes.json.conflicts)) {
            for (const c of pushRes.json.conflicts) {
              if (!c) continue;
              const candidateEnv = c.winner || (c.entityType && c.data ? c : null);
              if (candidateEnv) {
                const cType = String(candidateEnv.entityType || "").trim().toLowerCase();
                if (cType === "stocktake_session" && candidateEnv.data) {
                  cloudWinningSession = candidateEnv.data;
                } else if (cType === "branch_lockdown" && candidateEnv.data) {
                  cloudWinningLockdown = candidateEnv.data;
                }
                if (ingestCloudEnvelopeIntoHub(candidateEnv)) {
                  newlyPulledEnvelopes.push(candidateEnv);
                }
              }
            }
          }
          for (const pair of chunk) {
            const pId = String(pair.env.packetId);
            const failErr = failedMap.get(pId);
            if (failErr) {
              if (failErr === "ACTIVE_STOCKTAKE_ALREADY_EXISTS" && pair.hubType === "STOCKTAKE_SESSION") {
                const rejSessId = pair.rec.sessionId || pair.env.entityId;
                const nowMs = Date.now();
                const nowIso = new Date(nowMs).toISOString();
                const hasCounts = Array.isArray(pair.rec.segments) && pair.rec.segments.some(
                  (seg) => Array.isArray(seg.count1) && seg.count1.length > 0 || Array.isArray(seg.count2) && seg.count2.length > 0
                );
                const conflictReason = `Demoted by Cloud conflict: active stocktake already exists on this branch.`;
                if (hasCounts) {
                  pair.rec.pausedFromStatus = pair.rec.status;
                  pair.rec.status = "PAUSED";
                  pair.rec.pausedAt = nowIso;
                  pair.rec.pausedBy = "CLOUD_CONFLICT_GUARD";
                  pair.rec.pausedByName = "Cloud Conflict Guard";
                  pair.rec.pauseReason = conflictReason;
                  pair.rec.isLockdownActive = false;
                  pair.rec.isCloudSynced = true;
                } else {
                  pair.rec.status = "DRAFT";
                  pair.rec.isLockdownActive = false;
                  pair.rec.isCloudSynced = false;
                }
                pair.rec.updatedAt = nowMs;
                pair.rec.lastUpdated = nowIso;
                pair.rec.notes = `${pair.rec.notes ? pair.rec.notes + " | " : ""}${conflictReason}`;
                if (branchLockdownsStore && typeof branchLockdownsStore === "object") {
                  for (const brK of Object.keys(branchLockdownsStore)) {
                    const lk = branchLockdownsStore[brK];
                    if (lk && String(lk.sessionId || "").trim().toUpperCase() === String(rejSessId || "").trim().toUpperCase()) {
                      if (cloudWinningLockdown) {
                        branchLockdownsStore[brK] = { ...cloudWinningLockdown, isCloudSynced: true };
                      } else {
                        branchLockdownsStore[brK] = {
                          ...lk,
                          isLocked: false,
                          lockedAt: void 0,
                          updatedAt: nowMs,
                          lastUpdated: nowIso,
                          isCloudSynced: true
                        };
                      }
                    }
                  }
                }
                scheduleSave();
                try {
                  if (typeof wss !== "undefined" && wss && wss.clients) {
                    const conflictNotice = JSON.stringify({
                      type: "STOCKTAKE_SESSION_CONFLICT",
                      sessionId: rejSessId,
                      existingSessionId: cloudWinningSession?.sessionId || "",
                      existingSessionName: cloudWinningSession?.title || cloudWinningSession?.sessionName || cloudWinningSession?.sessionId || "Active Cloud Session",
                      existingSession: cloudWinningSession,
                      existingLockdown: cloudWinningLockdown,
                      message: `Cloud already has an active stocktake session. Local session ${rejSessId} was archived read-only.`,
                      timestamp: nowMs
                    });
                    wss.clients.forEach((client) => {
                      if (client && client.readyState === WebSocket.OPEN) {
                        try {
                          client.send(conflictNotice);
                        } catch (e) {
                        }
                      }
                    });
                  }
                } catch (e) {
                }
              } else if (failErr === "BRANCH_LOCKDOWN_SESSION_MISMATCH" && pair.hubType === "BRANCH_LOCKDOWN") {
                pair.rec.isCloudSynced = true;
              }
              continue;
            }
            if (ackedSet.has(pId) || ackedSet.size === 0 && failedMap.size === 0) {
              pair.rec.isCloudSynced = true;
              if (!pair.rec.server_received_at) pair.rec.server_received_at = srvIso;
              if (flaggedSet.has(pair.env.entityId)) pair.rec.suspicious_backdate = true;
              if (pair.env.class === "T1") {
                broadcastCloudSyncAck(null, pair.hubType, pair.env.entityId);
              }
            }
          }
        }
      } catch (pushErr) {
        console.warn("[Edge-to-Cloud] Cloud push_envelopes notice:", pushErr.message);
        break;
      }
    }
    if (pullSucceeded) {
      lastCloudSyncTimestamp = Date.now();
    }
    scheduleSave();
    if (newlyPulledEnvelopes.length > 0) {
      console.log(`[Edge-to-Cloud] \u{1F4E1} Broadcasting ${newlyPulledEnvelopes.length} cloud envelope(s) to connected terminals...`);
      const broadcastStr = JSON.stringify({
        type: "HUB_CLOUD_BROADCAST",
        action: "HUB_CLOUD_BROADCAST",
        envelopes: newlyPulledEnvelopes,
        hubTimestamp: Date.now(),
        branchId: hubBranchId,
        count: newlyPulledEnvelopes.length
      });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(broadcastStr);
          } catch (e) {
          }
        }
      });
    }
    return;
  }
  if (adapterCfg.databaseType !== "supabase") {
    return;
  }
  const activeSupabaseUrl = String(adapterCfg.credentials.url || adapterCfg.credentials.projectUrl || "").trim();
  const activeSupabaseKey = String(adapterCfg.credentials.apiKey || adapterCfg.credentials.serviceRoleKey || adapterCfg.credentials.anonKey || "").trim();
  if (!activeSupabaseUrl || !activeSupabaseKey) {
    return;
  }
  const cleanBase = activeSupabaseUrl.replace(/\/+$/, "");
  const headers = {
    apikey: activeSupabaseKey,
    Authorization: `Bearer ${activeSupabaseKey}`,
    "Content-Type": "application/json"
  };
  const newlyPulledRecords = [];
  for (const t of tablesToSync) {
    try {
      const queryTime = lastCloudSyncTimestamp > 0 ? new Date(lastCloudSyncTimestamp).toISOString() : (/* @__PURE__ */ new Date(0)).toISOString();
      const pullUrl = `${cleanBase}/rest/v1/${t.name}?updated_at=gt.${queryTime}&order=updated_at.asc&limit=250`;
      if (typeof fetch === "function") {
        const res = await fetch(pullUrl, { method: "GET", headers });
        if (res.ok) {
          const cloudRecords = await res.json();
          if (Array.isArray(cloudRecords) && cloudRecords.length > 0) {
            console.log(`[Edge-to-Cloud] \u2601\uFE0F Pulled ${cloudRecords.length} record(s) from Supabase table '${t.name}'`);
            for (const cRec of cloudRecords) {
              const recId = getEntityId(cRec, t.entityType);
              if (!recId) continue;
              const cleanId = String(recId).trim();
              if (!t.isT2) {
                const existingIdx = t.store.findIndex((s) => String(getEntityId(s, t.entityType)).trim() === cleanId);
                if (existingIdx === -1) {
                  cRec.isCloudSynced = true;
                  t.store.push(cRec);
                  newlyPulledRecords.push(cRec);
                } else if (t.entityType === "sales" && cRec.status && t.store[existingIdx].status !== cRec.status) {
                  t.store[existingIdx].status = cRec.status;
                  t.store[existingIdx].isCloudSynced = true;
                  newlyPulledRecords.push(t.store[existingIdx]);
                }
              } else {
                const cloudUpdated = getRecordTimestamp(cRec);
                if (isTombstoned(cleanId, t.entityType, cloudUpdated)) {
                  console.log(`[Edge-to-Cloud] \u{1FAA6} Resurrection Blocked for tombstoned ${t.entityType} #${cleanId}`);
                  continue;
                }
                const existingIdx = t.store.findIndex((s) => String(getEntityId(s, t.entityType)).trim() === cleanId);
                if (existingIdx === -1) {
                  cRec.isCloudSynced = true;
                  t.store.push(cRec);
                  newlyPulledRecords.push(cRec);
                } else {
                  const localUpdated = getRecordTimestamp(t.store[existingIdx]);
                  if (cloudUpdated - localUpdated > 6e4) {
                    cRec.isCloudSynced = true;
                    t.store[existingIdx] = cRec;
                    newlyPulledRecords.push(cRec);
                  }
                }
              }
            }
          }
        }
      }
      const unsynced = t.store.filter((r) => r && r.isCloudSynced !== true);
      if (unsynced.length > 0 && typeof fetch === "function") {
        const batchToPush = unsynced.slice(0, 50);
        const pushUrl = `${cleanBase}/rest/v1/${t.name}`;
        const pushRes = await fetch(pushUrl, {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "resolution=merge-duplicates"
          },
          body: JSON.stringify(batchToPush)
        });
        if (pushRes.ok || pushRes.status === 201) {
          const hdrDate = pushRes.headers && pushRes.headers.get ? pushRes.headers.get("date") : null;
          batchToPush.forEach((r) => {
            if (t.entityType === "sales" || t.entityType === "cash_logs") {
              annotateCloudBackdateFlag(t.entityType === "sales" ? "SALE" : "CASH_LOG", r, hdrDate);
            }
            r.isCloudSynced = true;
          });
          console.log(`[Edge-to-Cloud] \u{1F680} Pushed and upserted ${batchToPush.length} record(s) to Supabase table '${t.name}'`);
        }
      }
    } catch (tblErr) {
      console.warn(`[Edge-to-Cloud] Notice syncing table '${t.name}':`, tblErr.message);
    }
  }
  lastCloudSyncTimestamp = Date.now();
  scheduleSave();
  if (newlyPulledRecords.length > 0) {
    console.log(`[Edge-to-Cloud] \u{1F4E1} Broadcasting ${newlyPulledRecords.length} newly pulled cloud record(s) to connected terminals...`);
    const broadcastPkt = {
      type: "HUB_CLOUD_BROADCAST",
      action: "HUB_CLOUD_BROADCAST",
      records: newlyPulledRecords,
      hubTimestamp: Date.now(),
      branchId: hubBranchId,
      count: newlyPulledRecords.length
    };
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify(broadcastPkt));
        } catch (e) {
        }
      }
    });
  }
}
function restartCloudSyncTimer() {
  if (cloudSyncIntervalHandle) clearInterval(cloudSyncIntervalHandle);
  const intervalMs = Number(hubRuntimePolicy.syncIntervalMs) || 5 * 60 * 1e3;
  cloudSyncIntervalHandle = setInterval(() => {
    syncEdgeToCloudSupabase();
  }, intervalMs);
}
setTimeout(() => {
  syncEdgeToCloudSupabase();
}, 1e4);
restartCloudSyncTimer();
function flushBeforeExit(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (saveDirty || saveTimeout) {
    saveDataSyncAtomic();
  }
  if (signal) {
    process.exit(0);
  }
}
process.once("SIGINT", () => flushBeforeExit("SIGINT"));
process.once("SIGTERM", () => flushBeforeExit("SIGTERM"));
process.once("beforeExit", () => flushBeforeExit(null));

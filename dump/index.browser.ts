export * from './core/MeshNetwork';
export * from './core/TransportManager';
export * from './core/NetworkDispatcher';
export * from './core/NetworkController';
export * from './core/MeshOrchestrator';
export * from './core/UnifiedServer';
export * from './core/TransportFactory';
export * from './modules/NetworkModule';
export * from './transports/BaseTransport';
export * from './transports/browser/index';
export * from './contracts/packet.schema';
export * from './interfaces/ITransport';
export * from './serializers/BaseSerializer';
export * from './serializers/JSONSerializer';
export * from './serializers/BinarySerializer';
export * from './serializers/ProtoBufSerializer';
export * from './discovery/DHTDiscovery';
export * from './types/mesh.types';
export * from './utils/Env';
export * from './utils/Crypto';

// Re-export specific browser versions of transports under their common names 
// so TransportFactory can resolve them without Node dependencies.
export { BrowserWebSocketTransport as WSTransport } from './transports/browser/BrowserWebSocketTransport';
export { HTTPTransport } from './transports/browser/HTTPTransport';
export { TCPTransport } from './transports/browser/TCPTransport';
export { IPCTransport } from './transports/browser/IPCTransport';

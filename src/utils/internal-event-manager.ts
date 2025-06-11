import EventEmitter from "eventemitter3";

export class InternalEventManager {
    /**
     * The internal class instance. Needed to implement the Singleton pattern
     * @private
     */
    private static _instance: InternalEventManager = new InternalEventManager();

    /**
     * The event emitter
     * @private
     */
    private readonly _eventBroker: EventEmitter = new EventEmitter();

    /**
     * Private constructor for the Singleton pattern
     * @private
     */
    private constructor() {}

    /**
     * Registers a callback for a given event
     * @param event     the event
     * @param callback  the callback
     */
    static on(event: string, callback: (data: any) => any): void {
        this._instance._eventBroker.on(event, callback);
    }

    /**
     * Emits data for given event
     * @param event the event
     * @param data  the emitted data
     */
    static emit(event: string, data: any): void {
        this._instance._eventBroker.emit(event, data);
    }
}

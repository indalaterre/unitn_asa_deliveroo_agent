import type { Hashable } from "@utils/interfaces";

export class HashMap<K extends Hashable, V> {
    private readonly _map: Map<string, [K, V]>;

    public constructor(map?: Map<string, [K, V]>) {
        if (map !== undefined) {
            this._map = map;
        } else {
            this._map = new Map();
        }
    }

    public get(key: K): V | undefined {
        const entry = this._map.get(key.hashCode());
        return entry === undefined ? undefined : entry[1];
    }

    public set(key: K, value: V): void {
        this._map.set(key.hashCode(), [key, value]);
    }

    /**
     * Updates the value linked to the key
     * @param key               the value key
     * @param updateFunction    the updating function
     */
    public update(key: K, updateFunction: (value: V) => V): V {
        const updatedValue: V = updateFunction(this.get(key));
        this.set(key, updatedValue);

        return updatedValue;
    }

    public setAll(pairs: [K, V][]): void {
        for (const [key, value] of pairs) {
            this.set(key, value);
        }
    }

    public has(key: K): boolean {
        return this._map.has(key.hashCode());
    }

    public delete(key: K): void {
        this._map.delete(key.hashCode());
    }

    public clear(): void {
        this._map.clear();
    }

    public entries(): IterableIterator<[K, V]> {
        return this._map.values();
    }

    public entryArray(): [K, V][] {
        return Array.from(this._map.values());
    }

    public *values(): IterableIterator<V> {
        for (const [, value] of this._map.values()) {
            yield value;
        }
    }

    public *keys(): IterableIterator<K> {
        for (const [key] of this._map.values()) {
            yield key;
        }
    }

    public forEach(callback: (value: V, key: K) => void): void {
        for (const [key, value] of this._map.values()) {
            callback(value, key);
        }
    }

    public copy(): HashMap<K, V> {
        const map = new Map(this._map);
        return new HashMap(map);
    }

    public get size(): number {
        return this._map.size;
    }
}

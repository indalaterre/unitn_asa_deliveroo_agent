import type { Hashable } from "@utils/interfaces";

/**
 * Implement a set using the hashcode as discriminator
 */
export class HashSet<V extends Hashable> {
    //The internal map to store the data
    private readonly _map: Map<string, V> = new Map();

    constructor(values?: V[]) {
        this.addAll(values);
    }

    /**
     * ToString method
     */
    toString(): string {
        return this._map.values().toString();
    }

    /**
     * Adds a value to the set
     * @param value
     */
    add(value: V): HashSet<V> {
        this._map.set(value.hashCode(), value);
        return this;
    }

    /**
     * Adds a collection of values
     * @param values
     */
    addAll(values: V[]): HashSet<V> {
        if (values?.length) {
            for (const value of values) {
                this.add(value);
            }
        }

        return this;
    }

    /**
     * @param value
     * @returns TRUE if the set contains the value
     */
    has(value: V): boolean {
        return this._map.has(value.hashCode());
    }

    /**
     * Deletes the provided value
     * @param value
     */
    delete(value: V): HashSet<V> {
        this._map.delete(value.hashCode());
        return this;
    }

    /**
     * The number of occurrences
     */
    get count(): number {
        return Array.from(this._map.values()).length;
    }

    /**
     * @returns All the values into an array
     */
    get all(): V[] {
        return Array.from(this._map.values());
    }

    [Symbol.iterator](): Iterator<V> {
        return this._map.values()[Symbol.iterator]();
    }
}

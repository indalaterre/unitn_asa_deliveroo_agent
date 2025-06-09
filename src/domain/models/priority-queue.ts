/**
 * Represents a priority queue for intentions
 */
export class PriorityQueue<Type, T extends { type: Type; equals: (any: T) => boolean }> {
    /**
     * The elements of the queue
     * @private
     */
    private _elements: Array<{ element: T; priority: number }> = [];

    /**
     * @param sortingFn The generic DESC sorting function
     */
    constructor(
        private readonly sortingFn: (
            a: { element: T; priority: number },
            b: { element: T; priority: number },
        ) => number = (a, b) => b.priority - a.priority,
    ) {}

    /**
     * Adds an intention to the queue with the specified priority
     * Higher priority intentions will be processed first
     * @param intention The intention to add
     * @param priority The priority of the intention (higher values = higher priority)
     */
    public add(intention: T, priority: number): void {
        if (this.contains(intention)) {
            return;
        }

        this._elements.push({ element: intention, priority });
        this._sort();
    }

    /**
     * Removes and returns the highest priority intention
     * @returns The highest priority intention or null if the queue is empty
     */
    public poll(): T | null {
        if (this._elements.length === 0) {
            return null;
        }

        return this._elements.shift().element;
    }

    /**
     * Returns the highest priority intention without removing it
     * @returns The highest priority intention or null if the queue is empty
     */
    public peek(): T | null {
        if (this._elements.length === 0) {
            return null;
        }

        return this._elements[0].element;
    }

    /**
     * Checks if the queue contains the specified intention
     * @param intention The intention to check
     * @returns True if the queue contains the intention, false otherwise
     */
    public contains(intention: T): boolean {
        return this._elements.some((item) => item.element.equals(intention));
    }

    /**
     * Removes the specified intention from the queue
     * @param intention The intention to remove
     * @returns True if the intention was removed, false if it wasn't in the queue
     */
    public remove(intention: T): boolean {
        const initialLength = this._elements.length;
        this._elements = this._elements.filter((item) => !item.element.equals(intention));
        return initialLength !== this._elements.length;
    }

    /**
     * Checks if the queue is empty
     * @returns True if the queue is empty, false otherwise
     */
    public isEmpty(): boolean {
        return this._elements.length === 0;
    }

    /**
     * Checks if the queue contains an intention of the specified type
     * @param elementType The type of intention to check for
     * @returns True if the queue contains an intention of the specified type, false otherwise
     */
    public hasElementOfType(elementType: Type): boolean {
        return (
            this._elements?.length &&
            this._elements.some((item) => item.element.type === elementType)
        );
    }

    /**
     * Returns the number of intentions in the queue
     * @returns The number of intentions
     */
    get size(): number {
        return this._elements.length;
    }

    /**
     * Returns all intentions in the queue as an array
     * @returns Array of intentions
     */
    public toArray(): T[] {
        return [...this._elements.map((item) => item.element)];
    }

    /**
     * Clears the queue
     */
    public clear(): void {
        this._elements = [];
    }

    /**
     * Sorts the intentions by priority (descending)
     * @private
     */
    private _sort(): void {
        this._elements.sort((a, b) => this.sortingFn(a, b));
    }

    /**
     * ToString method
     */
    toString(): string {
        return this.toArray()
            .map((intention: T) => intention?.toString())
            .join("; ");
    }
}

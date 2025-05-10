import { type Intention, IntentionTypes } from "@domain/models/intention";

/**
 * Represents a priority queue for intentions
 * Intentions are ordered by priority (higher priority first)
 */
export class IntentionQueue {
    private _intentions: Array<{ intention: Intention; priority: number }> = [];

    /**
     * Adds an intention to the queue with the specified priority
     * Higher priority intentions will be processed first
     * @param intention The intention to add
     * @param priority The priority of the intention (higher values = higher priority)
     */
    public add(intention: Intention, priority: number): void {
        // Don't add duplicate intentions
        if (this.contains(intention)) {
            return;
        }

        this._intentions.push({ intention, priority });
        this._sort();
    }

    /**
     * Removes and returns the highest priority intention
     * @returns The highest priority intention or null if the queue is empty
     */
    public poll(): Intention | null {
        if (this._intentions.length === 0) {
            return null;
        }
        return this._intentions.shift().intention;
    }

    /**
     * Returns the highest priority intention without removing it
     * @returns The highest priority intention or null if the queue is empty
     */
    public peek(): Intention | null {
        if (this._intentions.length === 0) {
            return null;
        }
        return this._intentions[0].intention;
    }

    /**
     * Checks if the queue contains the specified intention
     * @param intention The intention to check
     * @returns True if the queue contains the intention, false otherwise
     */
    public contains(intention: Intention): boolean {
        return this._intentions.some((item) => item.intention.equals(intention));
    }

    /**
     * Removes the specified intention from the queue
     * @param intention The intention to remove
     * @returns True if the intention was removed, false if it wasn't in the queue
     */
    public remove(intention: Intention): boolean {
        const initialLength = this._intentions.length;
        this._intentions = this._intentions.filter((item) => !item.intention.equals(intention));
        return initialLength !== this._intentions.length;
    }

    /**
     * Updates the priority of an existing intention
     * @param intention The intention to update
     * @param newPriority The new priority
     * @returns True if the intention was found and updated, false otherwise
     */
    public updatePriority(intention: Intention, newPriority: number): boolean {
        const index = this._intentions.findIndex((item) => item.intention.equals(intention));
        if (index === -1) {
            return false;
        }

        this._intentions[index].priority = newPriority;
        this._sort();
        return true;
    }

    /**
     * Checks if the queue is empty
     * @returns True if the queue is empty, false otherwise
     */
    public isEmpty(): boolean {
        return this._intentions.length === 0;
    }

    /**
     * Checks if the queue contains an intention of the specified type
     * @param intentionType The type of intention to check for
     * @returns True if the queue contains an intention of the specified type, false otherwise
     */
    public hasIntentionOfType(intentionType: IntentionTypes): boolean {
        return this._intentions.some((item) => item.intention.type === intentionType);
    }

    /**
     * Returns the number of intentions in the queue
     * @returns The number of intentions
     */
    public size(): number {
        return this._intentions.length;
    }

    /**
     * Returns all intentions in the queue as an array
     * @returns Array of intentions
     */
    public toArray(): Intention[] {
        return this._intentions.map((item) => item.intention);
    }

    /**
     * Clears the queue
     */
    public clear(): void {
        this._intentions = [];
    }

    /**
     * Sorts the intentions by priority (descending)
     * @private
     */
    private _sort(): void {
        this._intentions.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Returns a default priority for an intention type
     * This can be used to assign initial priorities to intentions
     * @param type The intention type
     * @returns A default priority value
     */
    public static getDefaultPriority(type: IntentionTypes): number {
        switch (type) {
            case IntentionTypes.PICK_UP:
                return 100; // Highest priority - picking up parcels
            case IntentionTypes.PUT_DOWN:
                return 90; // High priority - putting down parcels
            case IntentionTypes.DELIVER:
                return 80; // Medium-high priority - delivering parcels
            case IntentionTypes.MOVE:
                return 70; // Medium priority - moving to a specific location
            case IntentionTypes.EXPLORE:
                return 50; // Lowest priority - exploring the environment
            default:
                return 60; // Default priority
        }
    }
}

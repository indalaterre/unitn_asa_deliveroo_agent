/**
 * Wraps the logic to manage time
 */
export class Instant {
    private constructor(private readonly _value: number) {}

    /**
     * @returns the instant related to the current time
     */
    static now(): Instant {
        return new Instant(Date.now());
    }

    /**
     * @returns the time in milliseconds from epoch
     */
    get milliseconds(): number {
        return this._value;
    }

    /**
     * Subtract the given instant from the current one
     * @param instant
     */
    subtract(instant: Instant): Duration {
        return Duration.fromMilliseconds(this.milliseconds - instant.milliseconds);
    }
}

/**
 * Models the duration given by time differences
 */
export class Duration {
    private constructor(private readonly _value: number) {}

    /**
     * @returns the time difference in milliseconds
     */
    get milliseconds(): number {
        return this._value;
    }

    /**
     * Creates an instance from a milliseconds amount
     * @param milliseconds
     */
    static fromMilliseconds(milliseconds: number) {
        return new Duration(milliseconds);
    }
}

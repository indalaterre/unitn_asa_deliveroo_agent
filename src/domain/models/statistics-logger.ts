import type { Duration } from "@domain/models/time";
import * as process from "node:process";

/**
 * Class for tracking and logging agent delivery statistics
 * Uses a single-line update approach to avoid cluttering the console
 */
export class StatisticsLogger {
    private _totalParcelsDelivered = 0;
    private _totalPointsEarned = 0;
    private _lastLogTime: number = Date.now();
    private _logIntervalMs = 1000; // Log every 5 seconds

    private _knownParcelsCount = -1;
    private _visibleParcelsCount = -1;

    private _knownAgentsCount = -1;
    private _friendAgentsCount = -1;

    private _previousPrintedLines = 0;

    private _avgPlanningExecutionTime: Duration = null;

    private _startingTime = Date.now();

    /**
     * Records a successful parcel delivery
     * @param parcelIds Array of parcel IDs that were delivered
     * @param pointsEarned Points earned from this delivery
     */
    recordDelivery(parcelIds: string[], pointsEarned: number): void {
        this._totalParcelsDelivered += parcelIds.length;
        this._totalPointsEarned += pointsEarned;

        // Check if it's time to log statistics
        this._logStatisticsIfNeeded();
    }

    updatePlanningTime(avgExecutionTime: Duration): void {
        this._avgPlanningExecutionTime = avgExecutionTime;
    }

    updateParcelsCount(visibleParcels: number, knownParcels: number): void {
        this._knownParcelsCount = knownParcels;
        this._visibleParcelsCount = visibleParcels;
    }

    updateAgentsCount(friendAgents: number, knownAgents: number): void {
        this._knownAgentsCount = knownAgents;
        this._friendAgentsCount = friendAgents;
    }

    /**
     * Forces logging of current statistics
     * Uses process.stdout to update a single line instead of creating new lines
     */
    public logStatistics(): void {
        const avgPointsPerParcel: string =
            this._totalParcelsDelivered > 0
                ? (this._totalPointsEarned / this._totalParcelsDelivered).toFixed(2)
                : "0.00";

        // Create a clean single-line output with statistics

        const lines: string[] = [];

        const timerLine = `⏱️ TIMER: ${this.formatElapsed()}`
        lines.push(timerLine)

        let statsLine: string =
            `\r📊 STATS: Parcels Delivered: ${this._totalParcelsDelivered} | ` +
            `Avg Points/Parcel: ${avgPointsPerParcel} | ` +
            `Total Points: ${this._totalPointsEarned}`;
        if (this._avgPlanningExecutionTime) {
            statsLine += ` | Avg Planning Time: ${this._avgPlanningExecutionTime.seconds.toFixed(2)} secs`;
        }

        lines.push(statsLine);

        if (this._visibleParcelsCount >= 0 && this._knownParcelsCount >= 0) {
            const visiblePercentage: string = (
                (this._visibleParcelsCount * 100) /
                this._knownParcelsCount
            ).toFixed(2);
            const parcelsLine: string =
                `📦 CONTEXT: Nearby Parcels: ${this._visibleParcelsCount} (${visiblePercentage}% of total) | ` +
                `Known Parcels ${this._knownParcelsCount}`;
            lines.push(parcelsLine);
        }

        if (this._knownAgentsCount >= 0 && this._friendAgentsCount >= 0) {
            const friendPercentage: string = (
                (this._friendAgentsCount * 100) /
                this._knownAgentsCount
            ).toFixed(2);

            const parcelsLine: string =
                `🧑‍🤝‍🧑 CONTEXT: Friend Agents: ${this._friendAgentsCount} (${friendPercentage}% of total) | ` +
                `Known Agents ${this._knownAgentsCount}`;
            lines.push(parcelsLine);
        }

        //Clearing the area by previous prints
        if(this._previousPrintedLines > 0) {
            process.stdout.write(`\x1B[${this._previousPrintedLines}F`); // move up this._previousPrintedLines lines
        }

        const linesToPrint: string[] = lines.filter(Boolean);
        for(const line of linesToPrint) {
            process.stdout.write('\x1B[2K'); // clear line
            process.stdout.write(line);
            process.stdout.write('\n')
        }

        this._previousPrintedLines = linesToPrint.length;
        this._lastLogTime = Date.now();
    }

    /**
     * Logs final statistics with a newline
     * Use this when the agent is stopping
     */
    public logFinalStatistics(): void {
        const avgPointsPerParcel =
            this._totalParcelsDelivered > 0
                ? (this._totalPointsEarned / this._totalParcelsDelivered).toFixed(2)
                : "0.00";

        // Create a clean output with statistics and add a newline
        console.log(
            `\r📊 FINAL STATS: Parcels Delivered: ${this._totalParcelsDelivered} | ` +
                `Avg Points/Parcel: ${avgPointsPerParcel} | ` +
                `Total Points: ${this._totalPointsEarned}`,
        );
    }

    /**
     * Logs statistics if the logging interval has elapsed
     * @private
     */
    private _logStatisticsIfNeeded(): void {
        const now = Date.now();
        if (now - this._lastLogTime >= this._logIntervalMs) {
            this.logStatistics();
        }
    }


    private formatElapsed(): string {
        const ms = Date.now() - this._startingTime;
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const seconds = (totalSeconds % 60).toString().padStart(2, '0');
        return `T+${minutes}:${seconds}`;
    }
}

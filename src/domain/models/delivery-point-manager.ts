import type { MatchMap } from "@domain/map";
import { Position } from "@domain/models/environment";
import { HashMap } from "@utils/hashmap";
import { HashSet } from "@utils/hashset";

/**
 * Represents the congestion status of a delivery point
 */
export interface DeliveryPointStatus {
    /**
     * The number of opponent agents currently at or heading to this delivery point
     */
    opponentCount: number;

    /**
     * The number of opponent agents in the surrounding area
     */
    surroundingOpponentCount: number;

    /**
     * The last time this delivery point was updated
     */
    lastUpdated: number;

    /**
     * Estimated waiting time in milliseconds
     */
    estimatedWaitTime: number;

    /**
     * Tactical advantage score (higher is better)
     * Represents how advantageous this delivery point is compared to others
     */
    tacticalAdvantageScore: number;
}

/**
 * Manages delivery point congestion and selection
 */
export class DeliveryPointManager {
    /**
     * Map of delivery point positions to their congestion status
     */
    private _deliveryPointStatus: HashMap<Position, DeliveryPointStatus> = new HashMap();

    /**
     * Reference to the map for calculating surrounding positions
     */
    private readonly _map: MatchMap;

    /**
     * Radius around delivery points to check for agent density
     */
    private readonly _surroundingRadius: number = 2;

    /**
     * Average time in milliseconds that an agent spends at a delivery point
     * @private
     */
    private readonly _averageDeliveryTime: number = 1000;

    /**
     * Maximum congestion level before considering a delivery point as highly congested
     * @private
     */
    private readonly _highCongestionThreshold: number = 3;

    /**
     * Decay factor for agent count (agents per millisecond)
     * @private
     */
    private readonly _agentCountDecayFactor: number = 0.0005;

    /**
     * Initializes the delivery point manager with the given delivery points
     * @param deliveryPoints The delivery points to track
     * @param map Reference to the map for calculating surrounding positions
     */
    constructor(deliveryPoints: Position[], map: MatchMap) {
        this._map = map;

        // Initialize all delivery points with zero congestion
        for (const point of deliveryPoints) {
            this._deliveryPointStatus.set(point, {
                opponentCount: 0,
                surroundingOpponentCount: 0,
                lastUpdated: Date.now(),
                estimatedWaitTime: 0,
                tacticalAdvantageScore: 0,
            });
        }
    }

    /**
     * Unregisters our agent from a delivery point (e.g., after delivery is complete)
     * @param position The delivery point position
     */
    public unregisterDeliveryIntent(position: Position): void {
        const status = this._getOrCreateStatus(position);

        // Just update the timestamp since this is our own agent
        status.lastUpdated = Date.now();

        this._deliveryPointStatus.set(position, status);
    }

    /**
     * Gets the opponent congestion level for a delivery point
     * @param position The delivery point position
     * @returns The congestion level (number of opponent agents)
     */
    public getOpponentCongestionLevel(position: Position): number {
        const status = this._getOrCreateStatus(position);
        this._updateStatus(position, status);
        return status.opponentCount;
    }

    /**
     * Gets the estimated wait time for a delivery point based on opponent congestion
     * @param position The delivery point position
     * @returns The estimated wait time in milliseconds
     */
    public getEstimatedWaitTime(position: Position): number {
        const status = this._getOrCreateStatus(position);
        this._updateStatus(position, status);
        return status.estimatedWaitTime;
    }

    /**
     * Gets the tactical advantage score for a delivery point
     * Higher scores indicate better tactical positions
     * @param position The delivery point position
     * @returns The tactical advantage score
     */
    public getTacticalAdvantageScore(position: Position): number {
        const status = this._getOrCreateStatus(position);
        this._updateStatus(position, status);
        return status.tacticalAdvantageScore;
    }

    /**
     * Checks if a delivery point is highly congested with opponents
     * @param position The delivery point position
     * @returns True if the delivery point is highly congested with opponents
     */
    public isHighlyCongested(position: Position): boolean {
        return this.getOpponentCongestionLevel(position) >= this._highCongestionThreshold;
    }

    /**
     * Calculates a competitive score for a delivery point based on distance and opponent positions
     * Lower scores are better (like costs)
     * @param position The delivery point position
     * @param distance The distance to the delivery point
     * @returns A weighted score (lower is better)
     */
    public calculateCongestionScore(position: Position, distance: number): number {
        const status: DeliveryPointStatus = this._getOrCreateStatus(position);
        this._updateStatus(position, status);

        const directOpponents = status.opponentCount;
        const surroundingOpponents = status.surroundingOpponentCount;
        const waitTime = status.estimatedWaitTime;
        const tacticalAdvantage = status.tacticalAdvantageScore;

        // Convert wait time to equivalent distance units (assuming 1 second = 1 distance unit)
        const waitTimeDistanceEquivalent = waitTime / 1000;

        // Base score is the distance plus wait time
        let score = distance + waitTimeDistanceEquivalent;

        // Strategic adjustments based on opponent positions
        if (directOpponents > 0) {
            // If there are opponents directly at the delivery point
            if (distance < 3) {
                // If we're very close, we might want to compete for it
                score += directOpponents * 1.5;
            } else {
                // If we're far, better avoid this contested point
                score += directOpponents * 3;
            }
        }

        // Surrounding opponents matter less but still important
        score += surroundingOpponents;

        // Tactical advantage reduces the score (makes the point more attractive)
        score -= tacticalAdvantage * 0.5;

        return score;
    }

    /**
     * Updates all delivery point statuses to account for time decay
     */
    public updateAllStatuses(): void {
        const now = Date.now();

        this._deliveryPointStatus.forEach((status, position) => {
            this._updateStatus(position, status, now);
        });
    }

    /**
     * Updates the surrounding opponent counts and tactical advantage for all delivery points
     * @param opponentPositions Current positions of opponent agents
     * @param ownPosition Our agent's current position
     */
    public updateOpponentPositions(opponentPositions: Position[], ownPosition: Position): void {
        // Create a set of opponent positions for faster lookups
        const opponentPositionsSet = new HashSet<Position>(opponentPositions);

        // Update surrounding opponent counts for each delivery point
        this._deliveryPointStatus.forEach((status, position) => {
            // Check if any opponents are directly at this delivery point
            status.opponentCount = opponentPositionsSet.has(position) ? 1 : 0;

            // Get surrounding positions within radius
            const surroundingPositions = this._getSurroundingPositions(position);

            // Count opponents in surrounding positions
            let surroundingCount = 0;
            for (const surroundingPos of surroundingPositions) {
                if (opponentPositionsSet.has(surroundingPos)) {
                    surroundingCount++;
                }
            }

            // Update opponent counts
            status.surroundingOpponentCount = surroundingCount;

            // Calculate tactical advantage score
            status.tacticalAdvantageScore = this._calculateTacticalAdvantage(
                position,
                ownPosition,
                opponentPositions,
            );

            // Update wait time based on opponent congestion
            status.estimatedWaitTime = this._calculateWaitTime(
                status.opponentCount,
                status.surroundingOpponentCount,
            );

            // Update the status
            this._deliveryPointStatus.set(position, status);
        });
    }

    /**
     * Gets positions surrounding a delivery point within the defined radius
     * @param position The central position
     * @returns Array of surrounding positions
     * @private
     */
    private _getSurroundingPositions(position: Position): Position[] {
        // Use the map's built-in method if available
        if (this._map.getTilesInDensityRadius) {
            return this._map.getTilesInDensityRadius(position);
        }

        // Fallback to a simple Manhattan distance calculation
        const surroundingPositions: Position[] = [];

        for (
            let row = position.row - this._surroundingRadius;
            row <= position.row + this._surroundingRadius;
            row++
        ) {
            for (
                let col = position.column - this._surroundingRadius;
                col <= position.column + this._surroundingRadius;
                col++
            ) {
                // Skip the center position
                if (row === position.row && col === position.column) continue;

                const pos = new Position(row, col);
                const manhattanDistance = position.manhattanDistance(pos);

                // Only include positions within the radius
                if (manhattanDistance <= this._surroundingRadius) {
                    surroundingPositions.push(pos);
                }
            }
        }

        return surroundingPositions;
    }

    /**
     * Gets or creates a status for a delivery point
     * @param position The delivery point position
     * @returns The delivery point status
     * @private
     */
    private _getOrCreateStatus(position: Position): DeliveryPointStatus {
        if (!this._deliveryPointStatus.has(position)) {
            return {
                opponentCount: 0,
                surroundingOpponentCount: 0,
                lastUpdated: Date.now(),
                estimatedWaitTime: 0,
                tacticalAdvantageScore: 0,
            };
        }

        return this._deliveryPointStatus.get(position);
    }

    /**
     * Updates a delivery point status to account for time decay
     * @param position The delivery point position
     * @param status The current status
     * @param now The current time (optional)
     * @private
     */
    private _updateStatus(
        position: Position,
        status: DeliveryPointStatus,
        now: number = Date.now(),
    ): void {
        const timeSinceUpdate = now - status.lastUpdated;

        // Apply time decay to opponent count
        const decayAmount = timeSinceUpdate * this._agentCountDecayFactor;
        status.opponentCount = Math.max(0, status.opponentCount - decayAmount);

        // Also apply a smaller decay to surrounding opponent count
        const surroundingDecayAmount = timeSinceUpdate * (this._agentCountDecayFactor * 0.5);
        status.surroundingOpponentCount = Math.max(
            0,
            status.surroundingOpponentCount - surroundingDecayAmount,
        );

        // Update wait time based on both direct and surrounding congestion
        status.estimatedWaitTime = this._calculateWaitTime(
            status.opponentCount,
            status.surroundingOpponentCount,
        );
        status.lastUpdated = now;

        this._deliveryPointStatus.set(position, status);
    }

    /**
     * Calculates the estimated wait time based on opponent count and surrounding opponent count
     * @param opponentCount The number of opponents at the delivery point
     * @param surroundingOpponentCount The number of opponents in the surrounding area
     * @returns The estimated wait time in milliseconds
     * @private
     */
    private _calculateWaitTime(opponentCount: number, surroundingOpponentCount = 0): number {
        // Direct congestion has full impact, surrounding congestion has partial impact
        return (
            opponentCount * this._averageDeliveryTime +
            surroundingOpponentCount * this._averageDeliveryTime * 0.3
        );
    }

    /**
     * Calculates a tactical advantage score for a delivery point
     * Higher scores mean better tactical positions
     * @param deliveryPoint The delivery point position
     * @param ownPosition Our agent's current position
     * @param opponentPositions Positions of all opponent agents
     * @returns A tactical advantage score (higher is better)
     * @private
     */
    private _calculateTacticalAdvantage(
        deliveryPoint: Position,
        ownPosition: Position,
        opponentPositions: Position[],
    ): number {
        // Base score starts at zero
        let score = 0;

        // Distance from our agent to the delivery point
        const ownDistance = deliveryPoint.manhattanDistance(ownPosition);

        // Calculate average distance from opponents to the delivery point
        let totalOpponentDistance = 0;
        for (const opponentPos of opponentPositions) {
            totalOpponentDistance += deliveryPoint.manhattanDistance(opponentPos);
        }

        const avgOpponentDistance =
            opponentPositions.length > 0 ? totalOpponentDistance / opponentPositions.length : 0;

        // If we're closer to the delivery point than the average opponent, that's an advantage
        if (ownDistance < avgOpponentDistance) {
            // The bigger the difference, the better the advantage
            score += (avgOpponentDistance - ownDistance) * 2;
        }

        // If there are no opponents nearby, that's a big advantage
        if (opponentPositions.length === 0) {
            score += 5;
        }

        return score;
    }
}

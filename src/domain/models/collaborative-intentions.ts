import { Position } from "./environment";
import { IntentionTypes } from "./intention";

/**
 * Extension of IntentionTypes to include collaborative intentions
 */
export enum CollaborativeIntentionTypes {
    // Extend the existing IntentionTypes
    HELP_OTHER = 5, // Help another agent with their task
    JOINT_PICKUP = 6, // Coordinate pickup with another agent
    JOINT_DELIVERY = 7, // Coordinate delivery with another agent
    TERRITORY_PATROL = 8, // Patrol a specific territory/region
    INITIATE_HANDOFF = 9, // Initiate a parcel handoff (sender)
    RECEIVE_HANDOFF = 10, // Receive a parcel handoff (receiver)
    WAIT_FOR_HANDOFF = 11, // Wait at meeting point for handoff
    COMPLETE_HANDOFF = 12, // Complete the handoff process
}

/**
 * Interface for collaborative intention context
 */
export interface CollaborativeIntentionContext {
    // The agent ID this collaboration is with
    targetAgentId: string;

    // The position where collaboration will occur
    meetingPosition?: Position;

    // IDs of parcels involved in the collaboration
    parcelIds?: string[];

    // Additional details specific to the collaboration type
    details?: any;

    // Expiration time for this collaboration
    expiresAt?: number;
}

/**
 * Interface for territory definition used in spatial partitioning
 */
export interface Territory {
    // Center position of the territory
    center: Position;

    // Radius of the territory (in grid units)
    radius: number;

    // Agent ID that claimed this territory
    claimedBy: string;

    // When this territory claim expires
    expiresAt: number;

    // Priority level of this territory (higher means more important)
    priority: number;
}

/**
 * Utility functions for collaborative intentions
 */
export class CollaborationUtils {
    /**
     * Determines if a position is within a territory
     * @param position Position to check
     * @param territory Territory to check against
     */
    static isPositionInTerritory(position: Position, territory: Territory): boolean {
        const distance =
            Math.abs(position.row - territory.center.row) +
            Math.abs(position.column - territory.center.column);
        return distance <= territory.radius;
    }

    /**
     * Calculates the best meeting point between two positions
     * @param position1 First position
     * @param position2 Second position
     */
    static calculateMeetingPoint(position1: Position, position2: Position): Position {
        // Simple implementation: midpoint between the two positions
        const midRow = Math.floor((position1.row + position2.row) / 2);
        const midCol = Math.floor((position1.column + position2.column) / 2);
        return new Position(midRow, midCol);
    }

    /**
     * Determines if a collaboration should be initiated based on utility
     * @param distanceToTarget Distance to the target
     * @param parcelValue Value of the parcel
     * @param agentScore Current score of the agent
     */
    static shouldCollaborate(
        distanceToTarget: number,
        parcelValue: number,
        agentScore: number,
    ): boolean {
        // Simple heuristic: collaborate if the parcel value is high enough relative to distance
        const collaborationThreshold = 0.5; // Adjust as needed
        const utility = parcelValue / (distanceToTarget + 1);

        // More likely to collaborate if agent has a low score (catch-up mechanism)
        const scoreFactor = Math.max(0.5, 1 - agentScore / 1000); // Adjust denominator based on expected score range

        return utility * scoreFactor > collaborationThreshold;
    }
}

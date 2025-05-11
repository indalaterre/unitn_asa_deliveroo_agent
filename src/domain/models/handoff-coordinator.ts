import type { Agent, Parcel } from "@domain/models";
import { Position } from "@domain/models/environment";
import { Intention, IntentionTypes } from "@domain/models/intention";
import { v4 as uuidv4 } from "uuid";

/**
 * Status of a handoff request
 */
export enum HandoffStatus {
    PENDING = "pending",
    ACCEPTED = "accepted",
    REJECTED = "rejected",
    IN_PROGRESS = "in_progress",
    COMPLETED = "completed",
    FAILED = "failed",
    EXPIRED = "expired",
}

/**
 * Represents a handoff request between agents
 */
export interface HandoffRequest {
    requestId: string;
    initiatorId: string;
    receiverId: string;
    parcelIds: string[];
    meetingPosition: Position;
    meetingPath: Position[];
    urgency: number;
    timeToMeet: number;
    expiresAt: number;
    status: HandoffStatus;
    estimatedArrivalTime?: number;
}

/**
 * Manages handoff coordination between agents
 */
export class HandoffCoordinator {
    // Outgoing handoff requests initiated by this agent
    private outgoingRequests: Map<string, HandoffRequest> = new Map();

    // Incoming handoff requests from other agents
    private incomingRequests: Map<string, HandoffRequest> = new Map();

    // Currently active handoff (if any)
    private activeHandoff: HandoffRequest | null = null;

    /**
     * Creates a new handoff request
     * @param initiatorId ID of the agent initiating the handoff
     * @param receiverId ID of the agent receiving the handoff
     * @param parcelIds IDs of parcels to hand off
     * @param meetingPosition Position where the handoff should occur
     * @param meetingPath Path to the meeting position
     * @param urgency Urgency of the handoff (1-10)
     * @param timeToMeet When to meet (timestamp)
     * @param expiresIn Time in milliseconds until this request expires
     * @returns The created handoff request
     */
    createHandoffRequest(
        initiatorId: string,
        receiverId: string,
        parcelIds: string[],
        meetingPosition: Position,
        meetingPath: Position[],
        urgency: number,
        timeToMeet: number,
        expiresIn = 30000, // Default to 30 seconds
    ): HandoffRequest {
        const requestId = uuidv4();
        const expiresAt = Date.now() + expiresIn;

        const request: HandoffRequest = {
            requestId,
            initiatorId,
            receiverId,
            parcelIds,
            meetingPosition,
            meetingPath,
            urgency,
            timeToMeet,
            expiresAt,
            status: HandoffStatus.PENDING,
        };

        this.outgoingRequests.set(requestId, request);
        return request;
    }

    /**
     * Registers an incoming handoff request
     * @param request The handoff request to register
     */
    registerIncomingRequest(request: HandoffRequest): void {
        this.incomingRequests.set(request.requestId, request);
    }

    /**
     * Accepts an incoming handoff request
     * @param requestId ID of the request to accept
     * @param estimatedArrivalTime When the agent expects to arrive at the meeting position
     * @returns The updated handoff request, or null if not found
     */
    acceptIncomingRequest(requestId: string, estimatedArrivalTime: number): HandoffRequest | null {
        const request = this.incomingRequests.get(requestId);
        if (!request) return null;

        request.status = HandoffStatus.ACCEPTED;
        request.estimatedArrivalTime = estimatedArrivalTime;
        this.activeHandoff = request;

        return request;
    }

    /**
     * Rejects an incoming handoff request
     * @param requestId ID of the request to reject
     * @returns The updated handoff request, or null if not found
     */
    rejectIncomingRequest(requestId: string): HandoffRequest | null {
        const request = this.incomingRequests.get(requestId);
        if (!request) return null;

        request.status = HandoffStatus.REJECTED;
        this.incomingRequests.delete(requestId);

        return request;
    }

    /**
     * Updates the status of an outgoing request based on a response
     * @param requestId ID of the request
     * @param accepted Whether the request was accepted
     * @param estimatedArrivalTime When the receiver expects to arrive
     * @returns The updated handoff request, or null if not found
     */
    updateOutgoingRequest(
        requestId: string,
        accepted: boolean,
        estimatedArrivalTime?: number,
    ): HandoffRequest | null {
        const request = this.outgoingRequests.get(requestId);
        if (!request) return null;

        request.status = accepted ? HandoffStatus.ACCEPTED : HandoffStatus.REJECTED;

        if (accepted) {
            request.estimatedArrivalTime = estimatedArrivalTime;
            this.activeHandoff = request;
        } else {
            this.outgoingRequests.delete(requestId);
        }

        return request;
    }

    /**
     * Completes a handoff
     * @param requestId ID of the request to complete
     * @param success Whether the handoff was successful
     * @returns The completed handoff request, or null if not found
     */
    completeHandoff(requestId: string, success: boolean): HandoffRequest | null {
        const request =
            this.outgoingRequests.get(requestId) || this.incomingRequests.get(requestId);
        if (!request) return null;

        request.status = success ? HandoffStatus.COMPLETED : HandoffStatus.FAILED;

        // Clean up the request
        this.outgoingRequests.delete(requestId);
        this.incomingRequests.delete(requestId);
        this.activeHandoff = null;

        return request;
    }

    /**
     * Gets the active handoff request (if any)
     * @returns The active handoff request, or null if none
     */
    getActiveHandoff(): HandoffRequest | null {
        return this.activeHandoff;
    }

    /**
     * Checks if there is an active handoff
     * @returns True if there is an active handoff
     */
    hasActiveHandoff(): boolean {
        return this.activeHandoff !== null;
    }

    /**
     * Gets all pending incoming handoff requests
     * @returns Array of pending incoming handoff requests
     */
    getPendingIncomingRequests(): HandoffRequest[] {
        return Array.from(this.incomingRequests.values()).filter(
            (request) => request.status === HandoffStatus.PENDING,
        );
    }

    /**
     * Gets all pending outgoing handoff requests
     * @returns Array of pending outgoing handoff requests
     */
    getPendingOutgoingRequests(): HandoffRequest[] {
        return Array.from(this.outgoingRequests.values()).filter(
            (request) => request.status === HandoffStatus.PENDING,
        );
    }

    /**
     * Creates an intention for a handoff
     * @param request The handoff request
     * @returns An intention to move to the handoff location
     */
    createHandoffIntention(request: HandoffRequest): Intention {
        return Intention.move(request.meetingPosition);
    }

    /**
     * Cleans up expired handoff requests
     */
    cleanupExpiredRequests(): void {
        const now = Date.now();

        // Clean up expired incoming requests
        for (const [requestId, request] of this.incomingRequests.entries()) {
            if (request.expiresAt < now && request.status === HandoffStatus.PENDING) {
                request.status = HandoffStatus.EXPIRED;
                this.incomingRequests.delete(requestId);
            }
        }

        // Clean up expired outgoing requests
        for (const [requestId, request] of this.outgoingRequests.entries()) {
            if (request.expiresAt < now && request.status === HandoffStatus.PENDING) {
                request.status = HandoffStatus.EXPIRED;
                this.outgoingRequests.delete(requestId);
            }
        }
    }

    /**
     * Evaluates if a handoff would be beneficial
     * @param ownPosition Current position of this agent
     * @param ownParcels Parcels carried by this agent
     * @param targetAgent Agent to potentially hand off to
     * @param deliveryPoints Available delivery points
     * @returns True if a handoff would be beneficial
     */
    isHandoffBeneficial(
        ownPosition: Position,
        ownParcels: Parcel[],
        targetAgent: Agent,
        deliveryPoints: Position[],
    ): boolean {
        if (ownParcels.length === 0) return false;

        // Find the closest delivery point to this agent
        let closestDeliveryToSelf = null;
        let minDistanceToSelf = Number.POSITIVE_INFINITY;

        for (const deliveryPoint of deliveryPoints) {
            const distance = ownPosition.manhattanDistance(deliveryPoint);
            if (distance < minDistanceToSelf) {
                minDistanceToSelf = distance;
                closestDeliveryToSelf = deliveryPoint;
            }
        }

        // Find closest delivery point to target agent
        let closestDeliveryToTarget = null;
        let minDistanceToTarget = Number.POSITIVE_INFINITY;

        for (const deliveryPoint of deliveryPoints) {
            const distance = targetAgent.position.manhattanDistance(deliveryPoint);
            if (distance < minDistanceToTarget) {
                minDistanceToTarget = distance;
                closestDeliveryToTarget = deliveryPoint;
            }
        }

        if (!closestDeliveryToSelf || !closestDeliveryToTarget) return false;

        // Calculate distances
        const selfToDelivery = minDistanceToSelf;
        const selfToTarget = ownPosition.manhattanDistance(targetAgent.position);
        const targetToDelivery = minDistanceToTarget;

        // Handoff is beneficial if:
        // 1. Target is closer to a delivery point than this agent
        // 2. The combined distance (self to target + target to delivery) is less than self to delivery
        return (
            targetToDelivery < selfToDelivery && selfToTarget + targetToDelivery < selfToDelivery
        );
    }

    /**
     * Finds the optimal meeting position for a handoff
     * @param ownPosition Current position of this agent
     * @param targetPosition Position of the target agent
     * @returns The optimal meeting position
     */
    findOptimalMeetingPosition(ownPosition: Position, targetPosition: Position): Position {
        // Simple implementation: meet in the middle
        const midRow = Math.floor((ownPosition.row + targetPosition.row) / 2);
        const midCol = Math.floor((ownPosition.column + targetPosition.column) / 2);

        return new Position(midRow, midCol);
    }
}

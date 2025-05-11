import type { BeliefContainer } from "@domain/beliefs";
import type { Messenger } from "@domain/communication/messenger";
import type { DesiresManager } from "@domain/desires";
import { GameConfiguration } from "@domain/models";
import type { Position } from "@domain/models/environment";
import { Intention } from "@domain/models/intention";
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
    meetingPath?: Position[];
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

    constructor(
        private readonly messenger: Messenger,
        private readonly beliefs: BeliefContainer,
        private readonly desiresManager: DesiresManager,
    ) {
        // Handle incoming handoff requests
        this.messenger.onHandoffRequestReceived(async (request: HandoffRequest) => {
            // Store the incoming request
            this.incomingRequests.set(request.requestId, request);
            // Process the incoming request (will be handled by the intention manager)
            await this.handleHandoffRequest(request);
        });

        // Set up periodic cleanup of expired requests
        setInterval(() => this.cleanupExpiredRequests(), 5000); // Check every 5 seconds
    }

    /**
     * Evaluates whether a handoff is feasible from the receiving agent's perspective
     * @param request The handoff request to evaluate
     * @returns True if the handoff appears feasible, false otherwise
     */
    private evaluateHandoffFeasibility(request: HandoffRequest): boolean {
        // Basic feasibility checks that don't require the beliefs container

        // Check if the request is too urgent (meeting time is too soon)
        const timeToMeeting = request.timeToMeet - Date.now();
        if (timeToMeeting < 2000) {
            // Less than 2 seconds to meet
            return false;
        }

        // Check if we already have an active handoff
        if (this.activeHandoff) {
            return false;
        }

        // Check if we can reach the meeting position
        if (this.beliefs.myPosition && request.meetingPosition) {
            // Calculate path to meeting position if possible
            const canReachMeeting = this.beliefs.calculateMovingPath(
                request.meetingPosition,
                this.beliefs.getOccupiedPositions(),
            );

            if (!canReachMeeting) {
                return false;
            }

            // Check if we can make it to the meeting on time
            const distanceToMeeting = this.beliefs.myPosition.manhattanDistance(
                request.meetingPosition,
            );
            const timeNeededToReach = distanceToMeeting * 1000; // Rough estimate: 1 second per tile

            if (timeToMeeting < timeNeededToReach) {
                return false;
            }
        }

        // If we passed all checks, the handoff appears feasible
        return true;
    }

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
    async createHandoffRequest(
        initiatorId: string,
        receiverId: string,
        parcelIds: string[],
        meetingPosition: Position,
        meetingPath: Position[],
        urgency: number,
        timeToMeet: number,
        expiresIn = 30000, // Default to 30 seconds
    ): Promise<HandoffRequest> {
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
        await this.messenger.sendHandoffRequest(request);

        return request;
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
     * Handles a handoff request from another agent
     * @param request The handoff request to handle
     */
    async handleHandoffRequest(request: HandoffRequest): Promise<void> {
        // Handle incoming requests based on status
        if (request.status === HandoffStatus.PENDING) {
            // Evaluate if we should accept the handoff
            const shouldAccept = this.evaluateHandoffFeasibility(request);

            if (shouldAccept) {
                // Calculate estimated arrival time
                const pathToMeeting: Position[] = this.beliefs.calculateMovingPath(
                    request.meetingPosition,
                    this.beliefs.getOccupiedPositions(),
                );

                const estimatedArrivalTime =
                    Date.now() +
                    (pathToMeeting?.length || 1) *
                        GameConfiguration.movementDuration.seconds *
                        1000;

                // Accept the request
                this.acceptIncomingRequest(request.requestId, estimatedArrivalTime);

                // Send acceptance response
                await this.messenger.sendHandoffConfirm(
                    request.requestId,
                    request.receiverId,
                    request.initiatorId,
                    estimatedArrivalTime,
                );

                // Create a move intention to the meeting position
                const intention: Intention = Intention.move(request.meetingPosition);
                intention.context = {
                    handoffRequestId: request.requestId,
                    isHandoff: true,
                    isReceiver: true, // Flag that we're receiving parcels
                    initiatorId: request.initiatorId,
                    parcelIds: request.parcelIds,
                };

                this.desiresManager.generateHandoffDesire(
                    request.requestId,
                    request.meetingPosition,
                );
            } else {
                // Reject the request
                this.rejectIncomingRequest(request.requestId);

                //TODO: Here we need to send the handoff response for the rejection
                throw Error("Handoff request rejected.");
            }
        }
    }
}

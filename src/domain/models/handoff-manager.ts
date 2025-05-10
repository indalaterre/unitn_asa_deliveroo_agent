import { v4 as uuidv4 } from "uuid";
import type {
    HandoffRequestMessage,
    HandoffResponseMessage,
    Messenger,
} from "../communication/messenger";
import {
    type CollaborativeBeliefs,
    type HandoffOperation,
    HandoffStatus,
} from "./collaborative-beliefs";
import { CollaborativeIntentionFactory } from "./collaborative-intention-factory";
import { Position } from "./environment";
import { Intention } from "./intention";
import type { IntentionQueue } from "./intention-queue";

/**
 * Manages handoff operations between agents
 */
export class HandoffManager {
    /**
     * Default expiration time for handoff requests (30 seconds)
     */
    private static readonly DEFAULT_EXPIRY_TIME = 30000;

    /**
     * Default meeting time (5 seconds from now)
     */
    private static readonly DEFAULT_MEETING_DELAY = 5000;

    /**
     * Default urgency for handoff requests (5 out of 10)
     */
    private static readonly DEFAULT_URGENCY = 5;

    /**
     * High priority value for handoff intentions
     */
    private static readonly HANDOFF_INTENTION_PRIORITY = 85;

    /**
     * Create a new HandoffManager
     * @param messenger Messenger implementation for communication
     * @param beliefs Collaborative beliefs
     * @param intentionQueue Intention queue
     * @param ownId ID of this agent
     */
    constructor(
        private readonly messenger: Messenger,
        private readonly beliefs: CollaborativeBeliefs,
        private readonly intentionQueue: IntentionQueue,
        private readonly ownId: string,
    ) {
        // Register for handoff message handling
        this.messenger.onMessageReceived(this.handleHandoffMessage.bind(this));
    }

    /**
     * Evaluates whether to initiate a handoff with another agent
     * @param currentPosition Current position of this agent
     * @param targetPosition Target/destination position (usually delivery point)
     * @param parcelIds IDs of parcels to potentially hand off
     * @param parcelScore Total score of the parcels
     * @param knownAgents Known agents to consider for handoff
     * @returns True if a handoff was initiated
     */
    evaluateHandoffOpportunity(
        currentPosition: Position,
        targetPosition: Position,
        parcelIds: string[],
        parcelScore: number,
        knownAgents: { agentId: string; position: Position }[],
    ): boolean {
        // Don't initiate handoffs if we don't have parcels
        if (!parcelIds.length) return false;

        // Don't initiate handoffs if we're already involved in an active handoff
        if (this.beliefs.getActiveHandoffs().length > 0) return false;

        // Evaluate each known agent for potential handoff
        for (const agent of knownAgents) {
            // Skip our own agent
            if (agent.agentId === this.ownId) continue;

            // Check if a handoff with this agent would be beneficial
            if (
                this.beliefs.shouldInitiateHandoff(
                    agent.agentId,
                    currentPosition,
                    targetPosition,
                    agent.position,
                    parcelScore,
                )
            ) {
                // Initiate handoff
                this.initiateHandoff(
                    agent.agentId,
                    parcelIds,
                    currentPosition,
                    agent.position,
                    Math.floor(parcelScore / 10), // Urgency based on parcel score
                );
                return true;
            }
        }

        return false;
    }

    /**
     * Initiates a handoff with another agent
     * @param targetAgentId ID of the agent to handoff to
     * @param parcelIds IDs of parcels to hand off
     * @param currentPosition Current position of this agent
     * @param targetAgentPosition Position of the target agent
     * @param urgency Priority of this handoff (1-10)
     * @returns The created handoff operation
     */
    private async initiateHandoff(
        targetAgentId: string,
        parcelIds: string[],
        currentPosition: Position,
        targetAgentPosition: Position,
        urgency: number = HandoffManager.DEFAULT_URGENCY,
    ): Promise<HandoffOperation | undefined> {
        // Calculate meeting position (midpoint)
        const meetingPosition = new Position(
            Math.floor((currentPosition.row + targetAgentPosition.row) / 2),
            Math.floor((currentPosition.column + targetAgentPosition.column) / 2),
        );

        // Calculate timing
        const now = Date.now();
        const timeToMeet = now + HandoffManager.DEFAULT_MEETING_DELAY;
        const expiresAt = now + HandoffManager.DEFAULT_EXPIRY_TIME;

        // Generate a unique request ID
        const requestId = uuidv4();

        try {
            // Send handoff request to the target agent
            await this.messenger.sendHandoffRequest(
                targetAgentId,
                parcelIds,
                meetingPosition,
                urgency,
                timeToMeet,
                HandoffManager.DEFAULT_EXPIRY_TIME,
            );

            // Create handoff operation in beliefs
            const handoff = this.beliefs.createHandoffOperation(
                requestId,
                this.ownId,
                targetAgentId,
                parcelIds,
                meetingPosition,
                timeToMeet,
                expiresAt,
                urgency,
            );

            // Create intention to go to meeting position
            const handoffIntention = CollaborativeIntentionFactory.createInitiateHandoffIntention(
                meetingPosition,
                targetAgentId,
                parcelIds,
                requestId,
            );

            // Add intention to queue with high priority
            this.intentionQueue.add(handoffIntention, HandoffManager.HANDOFF_INTENTION_PRIORITY);

            console.log(
                `Initiated handoff with agent ${targetAgentId} for parcels ${parcelIds.join(", ")} at position ${meetingPosition.toString()}`,
            );

            return handoff;
        } catch (error) {
            console.error(`Error initiating handoff with agent ${targetAgentId}:`, error);
            return undefined;
        }
    }

    /**
     * Handles incoming handoff messages
     * @param message The received message
     */
    private handleHandoffMessage(message: any): void {
        // Skip if not a handoff-related message
        if (!message.type || !message.type.includes("handoff")) {
            return;
        }

        try {
            switch (message.type) {
                case "handoff_request":
                    this.handleHandoffRequest(message as HandoffRequestMessage);
                    break;

                case "handoff_response":
                    this.handleHandoffResponse(message as HandoffResponseMessage);
                    break;

                case "handoff_confirm":
                    this.handleHandoffConfirm(message);
                    break;
            }
        } catch (error) {
            console.error("Error handling handoff message:", error);
        }
    }

    /**
     * Handles a handoff request from another agent
     * @param request The handoff request message
     */
    private async handleHandoffRequest(request: HandoffRequestMessage): Promise<void> {
        console.log(
            `Received handoff request from agent ${request.senderId} for parcels ${request.parcelIds.join(", ")} at position ${request.meetingPosition.toString()}`,
        );

        // Check if we should accept this handoff
        const shouldAccept = this.shouldAcceptHandoff(request);

        if (shouldAccept) {
            // Create handoff operation in beliefs
            this.beliefs.createHandoffOperation(
                request.requestId,
                request.senderId,
                this.ownId,
                request.parcelIds,
                request.meetingPosition,
                request.timeToMeet,
                request.expiresAt,
                request.urgency,
            );

            // Update status to accepted
            this.beliefs.updateHandoffStatus(request.requestId, HandoffStatus.ACCEPTED);

            // Create intention to go to meeting position
            const handoffIntention = CollaborativeIntentionFactory.createReceiveHandoffIntention(
                request.meetingPosition,
                request.senderId,
                request.parcelIds,
                request.requestId,
            );

            // Add intention to queue with high priority
            this.intentionQueue.add(handoffIntention, HandoffManager.HANDOFF_INTENTION_PRIORITY);

            // Calculate estimated arrival time based on distance
            // This is simplified - you might want to use actual pathfinding
            const distanceToMeeting = 5; // Replace with actual distance calculation
            const estimatedArrivalTime = Date.now() + distanceToMeeting * 1000;

            // Send response
            await this.messenger.sendHandoffResponse(
                request.senderId,
                request.requestId,
                true,
                request.parcelIds,
                request.meetingPosition,
                estimatedArrivalTime,
            );

            console.log(
                `Accepted handoff request ${request.requestId} from agent ${request.senderId}`,
            );
        } else {
            // Send rejection
            await this.messenger.sendHandoffResponse(
                request.senderId,
                request.requestId,
                false,
                request.parcelIds,
                request.meetingPosition,
                0,
            );

            console.log(
                `Rejected handoff request ${request.requestId} from agent ${request.senderId}`,
            );
        }
    }

    /**
     * Decides whether to accept a handoff request
     * @param request The handoff request
     * @returns True if the handoff should be accepted
     */
    private shouldAcceptHandoff(request: HandoffRequestMessage): boolean {
        // The receiving agent always trusts the sending agent
        // We only check if we're already involved in another handoff

        // Don't accept if we're already involved in an active handoff
        if (this.beliefs.getActiveHandoffs().length > 0) {
            return false;
        }

        // We could add more sophisticated logic here
        // For example, checking if we're closer to delivery points
        // or if we have capacity to receive more parcels

        // For now, accept handoffs as long as we're not already busy with another handoff
        return true;
    }

    /**
     * Handles a handoff response from another agent
     * @param response The handoff response message
     */
    private handleHandoffResponse(response: HandoffResponseMessage): void {
        // Get the handoff operation
        const handoff = this.beliefs.getHandoffOperation(response.requestId);
        if (!handoff) {
            console.log(`Received response for unknown handoff ${response.requestId}`);
            return;
        }

        if (response.accepted) {
            console.log(`Agent ${response.senderId} accepted handoff ${response.requestId}`);

            // Update handoff status
            this.beliefs.updateHandoffStatus(response.requestId, HandoffStatus.ACCEPTED, {
                estimatedArrivalTime: response.estimatedArrivalTime,
            });

            // We could update our intention based on the response
            // For example, adjusting priority or timing
        } else {
            console.log(`Agent ${response.senderId} rejected handoff ${response.requestId}`);

            // Update handoff status
            this.beliefs.updateHandoffStatus(response.requestId, HandoffStatus.REJECTED);

            // Remove any related intentions from the queue
            // This would require extending the IntentionQueue class
            // For now, the intention will be discarded when it's evaluated
        }
    }

    /**
     * Handles a handoff confirmation from another agent
     * @param confirm The handoff confirmation message
     */
    private handleHandoffConfirm(confirm: any): void {
        // Get the handoff operation
        const handoff = this.beliefs.getHandoffOperation(confirm.requestId);
        if (!handoff) {
            console.log(`Received confirmation for unknown handoff ${confirm.requestId}`);
            return;
        }

        // Update handoff status
        this.beliefs.updateHandoffStatus(
            confirm.requestId,
            confirm.success ? HandoffStatus.COMPLETED : HandoffStatus.FAILED,
        );

        console.log(`Handoff ${confirm.requestId} ${confirm.success ? "completed" : "failed"}`);
    }

    /**
     * Executes a handoff operation
     * @param handoffId ID of the handoff to execute
     * @param isInitiator Whether this agent initiated the handoff
     * @returns True if the handoff was completed
     */
    async executeHandoff(handoffId: string, isInitiator: boolean): Promise<boolean> {
        const handoff = this.beliefs.getHandoffOperation(handoffId);
        if (!handoff) return false;

        try {
            if (isInitiator) {
                // We are giving parcels
                // In a real implementation, this would call putDown()
                console.log(
                    `Putting down parcels ${handoff.parcelIds.join(", ")} for handoff ${handoffId}`,
                );

                // Update handoff status
                this.beliefs.updateHandoffStatus(handoffId, HandoffStatus.WAITING);

                // Send confirmation to the other agent
                await this.messenger.sendHandoffConfirm(
                    handoff.targetAgentId,
                    handoffId,
                    handoff.parcelIds,
                    true,
                    handoff.meetingPosition,
                );

                return true;
            } else {
                // We are receiving parcels
                // In a real implementation, this would call pickup()
                console.log(
                    `Picking up parcels ${handoff.parcelIds.join(", ")} from handoff ${handoffId}`,
                );

                // Update handoff status
                this.beliefs.updateHandoffStatus(handoffId, HandoffStatus.COMPLETED);

                // Send confirmation to the other agent
                await this.messenger.sendHandoffConfirm(
                    handoff.sourceAgentId,
                    handoffId,
                    handoff.parcelIds,
                    true,
                    handoff.meetingPosition,
                );

                return true;
            }
        } catch (error) {
            console.error(`Error executing handoff ${handoffId}:`, error);

            // Update handoff status
            this.beliefs.updateHandoffStatus(handoffId, HandoffStatus.FAILED);

            return false;
        }
    }
}

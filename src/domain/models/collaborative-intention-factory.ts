import { CollaborativeIntentionTypes } from "./collaborative-intentions";
import type { Position } from "./environment";
import { Intention, IntentionTypes } from "./intention";

/**
 * Factory for creating collaborative intentions
 */
export class CollaborativeIntentionFactory {
    /**
     * Creates an intention to initiate a handoff (for the agent giving parcels)
     * @param meetingPosition Position where the handoff will occur
     * @param targetAgentId ID of the agent to hand off to
     * @param parcelIds IDs of parcels to hand off
     * @param requestId ID of the handoff request
     */
    static createInitiateHandoffIntention(
        meetingPosition: Position,
        targetAgentId: string,
        parcelIds: string[],
        requestId: string,
    ): Intention {
        const intention = new Intention(IntentionTypes.MOVE, meetingPosition);

        // Add collaborative context
        intention.context = {
            collaborativeType: CollaborativeIntentionTypes.INITIATE_HANDOFF,
            targetAgentId,
            parcelIds,
            requestId,
            initiatedAt: Date.now(),
        };

        return intention;
    }

    /**
     * Creates an intention to receive a handoff (for the agent receiving parcels)
     * @param meetingPosition Position where the handoff will occur
     * @param sourceAgentId ID of the agent handing off parcels
     * @param parcelIds IDs of parcels to receive
     * @param requestId ID of the handoff request
     */
    static createReceiveHandoffIntention(
        meetingPosition: Position,
        sourceAgentId: string,
        parcelIds: string[],
        requestId: string,
    ): Intention {
        const intention = new Intention(IntentionTypes.MOVE, meetingPosition);

        // Add collaborative context
        intention.context = {
            collaborativeType: CollaborativeIntentionTypes.RECEIVE_HANDOFF,
            sourceAgentId,
            parcelIds,
            requestId,
            initiatedAt: Date.now(),
        };

        return intention;
    }

    /**
     * Creates an intention to wait for handoff at the meeting point
     * @param meetingPosition Position where the handoff will occur
     * @param otherAgentId ID of the other agent in the handoff
     * @param parcelIds IDs of parcels involved
     * @param requestId ID of the handoff request
     * @param maxWaitTime Maximum time to wait in milliseconds
     */
    static createWaitForHandoffIntention(
        meetingPosition: Position,
        otherAgentId: string,
        parcelIds: string[],
        requestId: string,
        maxWaitTime = 10000,
    ): Intention {
        const intention = new Intention(IntentionTypes.MOVE, meetingPosition);

        // Add collaborative context
        intention.context = {
            collaborativeType: CollaborativeIntentionTypes.WAIT_FOR_HANDOFF,
            otherAgentId,
            parcelIds,
            requestId,
            initiatedAt: Date.now(),
            expiresAt: Date.now() + maxWaitTime,
        };

        return intention;
    }

    /**
     * Creates an intention to complete a handoff
     * @param position Current position (where the handoff is happening)
     * @param otherAgentId ID of the other agent in the handoff
     * @param parcelIds IDs of parcels involved
     * @param requestId ID of the handoff request
     * @param isInitiator Whether this agent initiated the handoff
     */
    static createCompleteHandoffIntention(
        position: Position,
        otherAgentId: string,
        parcelIds: string[],
        requestId: string,
        isInitiator: boolean,
    ): Intention {
        // For the initiator, this will be a PUT_DOWN intention
        // For the receiver, this will be a PICK_UP intention
        const intentionType = isInitiator ? IntentionTypes.PUT_DOWN : IntentionTypes.PICK_UP;
        const intention = new Intention(intentionType, position);

        // Add collaborative context
        intention.context = {
            collaborativeType: CollaborativeIntentionTypes.COMPLETE_HANDOFF,
            otherAgentId,
            parcelIds,
            requestId,
            isInitiator,
            initiatedAt: Date.now(),
        };

        return intention;
    }

    /**
     * Determines if an intention is a collaborative handoff intention
     * @param intention The intention to check
     */
    static isHandoffIntention(intention: Intention): boolean {
        return (
            intention?.context?.collaborativeType !== undefined &&
            (intention.context.collaborativeType === CollaborativeIntentionTypes.INITIATE_HANDOFF ||
                intention.context.collaborativeType ===
                    CollaborativeIntentionTypes.RECEIVE_HANDOFF ||
                intention.context.collaborativeType ===
                    CollaborativeIntentionTypes.WAIT_FOR_HANDOFF ||
                intention.context.collaborativeType ===
                    CollaborativeIntentionTypes.COMPLETE_HANDOFF)
        );
    }

    /**
     * Gets the collaborative intention type from an intention
     * @param intention The intention to check
     */
    static getCollaborativeType(intention: Intention): CollaborativeIntentionTypes | undefined {
        return intention?.context?.collaborativeType;
    }
}

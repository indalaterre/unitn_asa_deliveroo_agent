import type { Agent, Parcel } from "@domain/models";
import type { Position } from "@domain/models/environment";
import { IdAware } from "@domain/models/id-aware";
import type { IntentionTypes } from "@domain/models/intention";
import {
    type AgentPositionUpdate,
    type CoordinationMessage,
    type HandoffConfirmMessage,
    type HandoffRequestMessage,
    type HandoffResponseMessage,
    type HelloMessage,
    type HelpRequestMessage,
    type HelpResponseMessage,
    type IntentionMessage,
    type Message,
    MessageType,
    type ParcelInfoMessage,
} from "./messenger";

/**
 * Factory class for creating different types of messages
 */
export class MessageFactory {
    /**
     * Create a base message with common fields
     * @param type Message type
     * @param senderId ID of the sending agent
     * @returns Base message object
     */
    private static createBaseMessage(type: MessageType, senderId: string): Message {
        return {
            type,
            senderId,
            timestamp: Date.now(),
        };
    }

    /**
     * Create a Hello message
     * @param senderId ID of the sending agent
     * @param position Current position of the agent
     * @param score Current score of the agent
     * @returns HelloMessage object
     */
    public static createHelloMessage(
        senderId: string,
        position: Position,
        score: number,
    ): HelloMessage {
        return {
            ...this.createBaseMessage(MessageType.HELLO, senderId),
            type: MessageType.HELLO,
            senderId,
            position,
            score,
        };
    }

    /**
     * Create an Intention message
     * @param senderId ID of the sending agent
     * @param intentionType Type of intention
     * @param targetPosition Target position of the intention
     * @param currentPosition Current position of the agent
     * @param priority Optional priority of this intention
     * @returns IntentionMessage object
     */
    public static createIntentionMessage(
        senderId: string,
        intentionType: IntentionTypes,
        targetPosition: Position,
        currentPosition: Position,
        priority?: number,
    ): IntentionMessage {
        return {
            ...this.createBaseMessage(MessageType.INTENTION, senderId),
            type: MessageType.INTENTION,
            intentionType,
            targetPosition,
            currentPosition,
            priority,
        };
    }

    /**
     * Create a Parcel Info message
     * @param senderId ID of the sending agent
     * @param agents Array of agents information to share
     * @returns ParcelInfoMessage object
     */
    public static createAgentsUpdateMessage(
        senderId: string,
        agents: Agent[],
    ): AgentPositionUpdate {
        const messageAgents = agents.map((agent: Agent) => {
            return {
                agentId: agent.agentId,
                position: agent.position,
                score: agent.score,
            };
        });
        return {
            ...this.createBaseMessage(MessageType.AGENT_UPDATE, senderId),
            agents: messageAgents,
            type: MessageType.AGENT_UPDATE,
        };
    }

    /**
     * Create a Parcel Info message
     * @param senderId ID of the sending agent
     * @param parcels Array of parcel information to share
     * @returns ParcelInfoMessage object
     */
    public static createParcelInfoMessage(senderId: string, parcels: Parcel[]): ParcelInfoMessage {
        const messageParcels = parcels.map((parcel: Parcel) => {
            return {
                id: parcel.id,
                position: parcel.position,
                score: parcel.score.currentValue,
                agentId: parcel.agentId?.toString(),
            };
        });

        return {
            ...this.createBaseMessage(MessageType.PARCEL_INFO, senderId),
            type: MessageType.PARCEL_INFO,
            parcels: messageParcels,
        };
    }

    /**
     * Create a Help Request message
     * @param senderId ID of the sending agent
     * @param requestType Type of help needed ("pickup" or "delivery")
     * @param position Position where help is needed
     * @param urgency Urgency level (1-10)
     * @param expiresAt Timestamp when this request expires
     * @param parcelIds Optional IDs of parcels involved
     * @returns HelpRequestMessage object with a generated requestId
     */
    public static createHelpRequestMessage(
        senderId: string,
        requestType: "pickup" | "delivery",
        position: Position,
        urgency: number,
        expiresAt: number,
        parcelIds?: string[],
    ): HelpRequestMessage {
        const requestId = `help-${senderId}-${Date.now()}`;
        return {
            ...this.createBaseMessage(MessageType.HELP_REQUEST, senderId),
            type: MessageType.HELP_REQUEST,
            requestId,
            requestType,
            position,
            urgency,
            expiresAt,
            parcelIds,
        };
    }

    /**
     * Create a Help Response message
     * @param senderId ID of the sending agent
     * @param requestId ID of the request being responded to
     * @param accepted Whether the help request is accepted
     * @param estimatedTimeToArrive Optional estimated time to arrive (in milliseconds)
     * @returns HelpResponseMessage object
     */
    public static createHelpResponseMessage(
        senderId: string,
        requestId: string,
        accepted: boolean,
        estimatedTimeToArrive?: number,
    ): HelpResponseMessage {
        return {
            ...this.createBaseMessage(MessageType.HELP_RESPONSE, senderId),
            type: MessageType.HELP_RESPONSE,
            requestId,
            accepted,
            estimatedTimeToArrive,
        };
    }

    /**
     * Create a Coordination message
     * @param senderId ID of the sending agent
     * @param action Type of coordination action
     * @param position Position related to the coordination
     * @param details Additional details about the coordination
     * @returns CoordinationMessage object
     */
    public static createCoordinationMessage(
        senderId: string,
        action: "split_parcels" | "clear_area" | "joint_delivery" | "territory_claim",
        position: Position,
        details: any,
    ): CoordinationMessage {
        return {
            ...this.createBaseMessage(MessageType.COORDINATION, senderId),
            type: MessageType.COORDINATION,
            action,
            position,
            details,
        };
    }

    /**
     * Create a Handoff Request message
     * @param senderId ID of the sending agent
     * @param parcelIds IDs of parcels to hand off
     * @param meetingPosition Proposed meeting location
     * @param urgency Priority of this handoff (1-10)
     * @param timeToMeet When to meet (timestamp)
     * @param expiresAt When this request expires
     * @returns HandoffRequestMessage object with a generated requestId
     */
    public static createHandoffRequestMessage(
        senderId: string,
        parcelIds: string[],
        meetingPosition: Position,
        urgency: number,
        timeToMeet: number,
        expiresAt: number,
    ): HandoffRequestMessage {
        const requestId = `handoff-${senderId}-${Date.now()}`;
        return {
            ...this.createBaseMessage(MessageType.HANDOFF_REQUEST, senderId),
            type: MessageType.HANDOFF_REQUEST,
            requestId,
            parcelIds,
            meetingPosition,
            urgency,
            timeToMeet,
            expiresAt,
        };
    }

    /**
     * Create a Handoff Response message
     * @param senderId ID of the sending agent
     * @param requestId ID of the request being responded to
     * @param accepted Whether the handoff is accepted
     * @param parcelIds Confirmed parcel IDs to be handed off
     * @param meetingPosition Confirmed meeting location
     * @param estimatedArrivalTime When the agent expects to arrive
     * @returns HandoffResponseMessage object
     */
    public static createHandoffResponseMessage(
        senderId: string,
        requestId: string,
        accepted: boolean,
        parcelIds: string[],
        meetingPosition: Position,
        estimatedArrivalTime: number,
    ): HandoffResponseMessage {
        return {
            ...this.createBaseMessage(MessageType.HANDOFF_RESPONSE, senderId),
            type: MessageType.HANDOFF_RESPONSE,
            requestId,
            accepted,
            parcelIds,
            meetingPosition,
            estimatedArrivalTime,
        };
    }

    /**
     * Create a Handoff Confirm message
     * @param senderId ID of the sending agent
     * @param requestId ID of the original request
     * @param parcelIds IDs of parcels that were handed off
     * @param success Whether the handoff was successful
     * @param position Where the handoff occurred
     * @returns HandoffConfirmMessage object
     */
    public static createHandoffConfirmMessage(
        senderId: string,
        requestId: string,
        parcelIds: string[],
        success: boolean,
        position: Position,
    ): HandoffConfirmMessage {
        return {
            ...this.createBaseMessage(MessageType.HANDOFF_CONFIRM, senderId),
            type: MessageType.HANDOFF_CONFIRM,
            requestId,
            parcelIds,
            success,
            position,
        };
    }
}

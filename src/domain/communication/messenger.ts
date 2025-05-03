/**
 * Defines the messaging methods to communicate with other agents
 * "Shout" methods: sends messages in broadcast
 * "Send"  methods: sends messages to a specific agent
 */
export interface Messenger {
    shoutHelloMessage();
}

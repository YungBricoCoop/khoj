import { App, Modal, request } from 'obsidian';
import { KhojSetting } from 'src/settings';
import { toColor } from "./utils";
import fetch from "node-fetch";

export class KhojChatModal extends Modal {
	result: string;
	setting: KhojSetting;

	constructor(app: App, setting: KhojSetting) {
		super(app);
		this.setting = setting;
		this.contentEl.style.setProperty('--khoj-chat-primary', toColor(this.setting.primary));
		this.contentEl.style.setProperty('--khoj-chat-dark-grey', toColor(this.setting.secondary));

		// Register Modal Keybindings to send user message
		this.scope.register([], 'Enter', async () => {
			// Get text in chat input elmenet
			const input_el = <HTMLInputElement>this.contentEl.getElementsByClassName("khoj-chat-input")[0];

			// Clear text after extracting message to send
			const user_message = input_el.value;
			input_el.value = "";

			// Get and render chat response to user message
			await this.getChatResponse(user_message);
		});
	}

	async onOpen() {
		const { contentEl } = this;

		contentEl.addClass("khoj-chat");

		// Add title to the Khoj Chat modal
		contentEl.createEl("h1", ({ attr: { id: "khoj-chat-title" }, text: "Khoj Chat" }));

		// Create area for chat logs
		contentEl.createDiv({ attr: { id: "khoj-chat-body", class: "khoj-chat-body" } });

		// Get chat history from Khoj backend
		await this.getChatHistory();

		// Add chat input field
		contentEl.createEl("input",
			{
				attr: {
					type: "text",
					id: "khoj-chat-input",
					autofocus: "autofocus",
					placeholder: "Chat with Khoj [Hit Enter to send message]",
					class: "khoj-chat-input option"
				}
			})
			.addEventListener('change', (event) => { this.result = (<HTMLInputElement>event.target).value });

		// Scroll to bottom of modal, till the send message input box
		this.modalEl.scrollTop = this.modalEl.scrollHeight;
	}

	generateReference(messageEl: any, reference: string, index: number) {
		// Generate HTML for Chat Reference
		// `<sup><abbr title="${escaped_ref}" tabindex="0">${index}</abbr></sup>`;
		const escaped_ref = reference.replace(/"/g, "&quot;")
		return messageEl.createEl("sup").createEl("abbr", {
			attr: {
				title: escaped_ref,
				tabindex: "0",
			},
			text: `[${index}] `,
		});
	}

	renderMessageWithReferences(message: string, sender: string, context?: [string], dt?: Date) {
		const messageEl = this.renderMessage(message, sender, dt);
		if (context && !!messageEl) {
			context.map((reference, index) => this.generateReference(messageEl, reference, index + 1));
		}
	}

	renderMessage(message: string, sender: string, dt?: Date): Element | null {
		const message_time = this.formatDate(dt ?? new Date());
		const emojified_sender = sender == "khoj" ? "🏮 Khoj" : "🤔 You";

		// Append message to conversation history HTML element.
		// The chat logs should display above the message input box to follow standard UI semantics
		const chat_body_el = this.contentEl.getElementsByClassName("khoj-chat-body")[0];
		const chat_message_el = chat_body_el.createDiv({
			attr: {
				"data-meta": `${emojified_sender} at ${message_time}`,
				class: `khoj-chat-message ${sender}`
			},
		}).createDiv({
			attr: {
				class: `khoj-chat-message-text ${sender}`
			},
			text: `${message}`
		})

		// Remove user-select: none property to make text selectable
		chat_message_el.style.userSelect = "text";

		// Scroll to bottom after inserting chat messages
		this.modalEl.scrollTop = this.modalEl.scrollHeight;

		return chat_message_el
	}

	createKhojResponseDiv(dt?: Date): HTMLDivElement {
		const message_time = this.formatDate(dt ?? new Date());

		// Append message to conversation history HTML element.
		// The chat logs should display above the message input box to follow standard UI semantics
		const chat_body_el = this.contentEl.getElementsByClassName("khoj-chat-body")[0];
		const chat_message_el = chat_body_el.createDiv({
			attr: {
				"data-meta": `🏮 Khoj at ${message_time}`,
				class: `khoj-chat-message khoj`
			},
		}).createDiv({
			attr: {
				class: `khoj-chat-message-text khoj`
			},
		})

		// Scroll to bottom after inserting chat messages
		this.modalEl.scrollTop = this.modalEl.scrollHeight;

		return chat_message_el
	}

	renderIncrementalMessage(htmlElement: HTMLDivElement, additionalMessage: string) {
		htmlElement.innerHTML += additionalMessage;
		// Scroll to bottom of modal, till the send message input box
		this.modalEl.scrollTop = this.modalEl.scrollHeight;
	}

	formatDate(date: Date): string {
		// Format date in HH:MM, DD MMM YYYY format
		const time_string = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
		const date_string = date.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' }).replace(/-/g, ' ');
		return `${time_string}, ${date_string}`;
	}

	async getChatHistory(): Promise<void> {
		// Get chat history from Khoj backend
		const chatUrl = `${this.setting.khojUrl}/api/chat/history?client=obsidian`;
		const response = await request(chatUrl);
		const chatLogs = JSON.parse(response).response;
		chatLogs.forEach((chatLog: any) => {
			this.renderMessageWithReferences(chatLog.message, chatLog.by, chatLog.context, new Date(chatLog.created));
		});
	}

	async getChatResponse(query: string | undefined | null): Promise<void> {
		// Exit if query is empty
		if (!query || query === "") return;

		// Render user query as chat message
		this.renderMessage(query, "you");

		// Get chat response from Khoj backend
		const encodedQuery = encodeURIComponent(query);
		const chatUrl = `${this.setting.khojUrl}/api/chat?q=${encodedQuery}&n=${this.setting.resultsCount}&client=obsidian&stream=true`;
		const responseElement = this.createKhojResponseDiv();

		// Temporary status message to indicate that Khoj is thinking
		this.renderIncrementalMessage(responseElement, "🤔");

		const response = await fetch(chatUrl, {
			method: "GET",
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Content-Type": "text/event-stream"
			},
		})

		try {
			if (response.body == null) {
				throw new Error("Response body is null");
			}
			// Clear thinking status message
			if (responseElement.innerHTML === "🤔") {
				responseElement.innerHTML = "";
			}

			for await (const chunk of response.body) {
				const responseText = chunk.toString();
				if (responseText.startsWith("### compiled references:")) {
					return;
				}
				this.renderIncrementalMessage(responseElement, responseText);
			}
		} catch (err) {
			this.renderIncrementalMessage(responseElement, "Sorry, unable to get response from Khoj backend ❤️‍🩹. Contact developer for help at team@khoj.dev or <a href='https://discord.gg/BDgyabRM6e'>in Discord</a>")
		}
	}
}

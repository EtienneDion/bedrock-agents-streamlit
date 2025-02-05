'use client';

import React, { useState, useEffect } from 'react';
import { useChat } from 'ai/react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
// Import the lambdaHandler function which replaces the fetch() call.
// (Make sure this module is available and properly bundled for your project.)
import { lambdaHandler } from '@/lib/lambdaHandler';

/**
 * Chat component that renders a chat UI and uses the lambdaHandler function
 * to get responses from the backend instead of making a fetch() API call.
 */
export default function Chat() {
  // State for a unique session id (generated on component mount).
  const [sessionId, setSessionId] = useState('');
  // Loading state while waiting for the lambdaHandler to return.
  const [isLoading, setIsLoading] = useState(false);
  // useChat hook provides the messages, input value, and helper functions.
  const { messages, input, handleInputChange, setMessages } = useChat();

  // useEffect to generate a unique session ID and load any existing chat history.
  useEffect(() => {
    // Generate a unique session ID.
    setSessionId(Math.random().toString(36).substring(7));

    // Load chat history from IndexedDB.
    const loadHistory = async () => {
      const db = await openDatabase();
      const history = await getHistory(db);
      setMessages(history);
    };
    loadHistory();
  }, [setMessages]);

  /**
   * Handler for the chat form submission.
   * Instead of using fetch(), this function calls the lambdaHandler directly.
   *
   * @param e The form submission event.
   */
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    // Create a new message for the user's input and add it to the chat.
    const newMessage = { role: 'user', content: input };
    setMessages((prevMessages) => [...prevMessages, newMessage]);

    try {
      // Construct the event object for the lambdaHandler.
      const event = {
        sessionId,
        question: input,
        endSession: false,
      };

      // Call the lambdaHandler function directly.
      const lambdaResponse = await lambdaHandler(event, {});

      // Check for errors based on the returned status code.
      if (lambdaResponse.statusCode !== 200) {
        throw new Error('API request failed with status ' + lambdaResponse.statusCode);
      }

      // Parse the JSON response body.
      const parsedBody = JSON.parse(lambdaResponse.body);
      // The lambdaHandler returns an object with "trace_data" holding the assistant’s answer.
      const assistantContent = parsedBody.trace_data;

      // Create the assistant message.
      const assistantMessage = { role: 'assistant', content: assistantContent };

      // Update the chat with the assistant's response.
      setMessages((prevMessages) => [...prevMessages, assistantMessage]);

      // Save the assistant message to IndexedDB.
      const db = await openDatabase();
      await addMessageToHistory(db, assistantMessage);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>AI Chat</CardTitle>
        </CardHeader>
        <CardContent className="h-[60vh] overflow-y-auto">
          {messages.map((m, index) => (
            <div key={index} className={`mb-4 ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
              <span className={`inline-block p-2 rounded-lg ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-black'}`}>
                {m.content}
              </span>
            </div>
          ))}
          {isLoading && (
            <div className="text-center">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
        </CardContent>
        <CardFooter>
          <form onSubmit={onSubmit} className="flex w-full space-x-2">
            <Input
              value={input}
              onChange={handleInputChange}
              placeholder="Type your message..."
              className="flex-grow"
            />
            <Button type="submit" disabled={isLoading}>Send</Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  );
}

/* =====================================================
   IndexedDB Utility Functions for Storing Chat History
   ===================================================== */

/**
 * Opens (or creates) the IndexedDB database used for storing chat history.
 *
 * @returns A Promise that resolves with the opened IDBDatabase instance.
 */
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ChatHistory', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('messages', { autoIncrement: true });
    };
  });
}

/**
 * Adds a chat message to the IndexedDB history.
 *
 * @param db The open IDBDatabase instance.
 * @param message The message object to be saved.
 * @returns A Promise that resolves when the message is successfully added.
 */
async function addMessageToHistory(db: IDBDatabase, message: { role: string; content: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readwrite');
    const store = transaction.objectStore('messages');
    const request = store.add(message);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Retrieves all chat messages from IndexedDB.
 *
 * @param db The open IDBDatabase instance.
 * @returns A Promise that resolves with an array of stored message objects.
 */
async function getHistory(db: IDBDatabase): Promise<{ role: string; content: string }[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readonly');
    const store = transaction.objectStore('messages');
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
import { useState, useCallback, useRef } from "react";


interface AISuggestionsState {
    suggestion: string | null;
    isLoading: boolean;
    position: { line: number; column: number } | null;
    decoration: string[];
    isEnabled: boolean;
}

interface UseAISuggestionsReturn extends AISuggestionsState {
    toggleEnabled: () => void;
    fetchSuggestion: (type: string, editor: any) => Promise<void>;
    acceptSuggestion: (editor: any, monaco: any) => void;
    rejectSuggestion: (editor: any) => void;
    clearSuggestion: (editor: any) => void;
}

export const useAISuggestions = (): UseAISuggestionsReturn => {
    const [state, setState] = useState<AISuggestionsState>({
        suggestion: null,
        isLoading: false,
        position: null,
        decoration: [],
        isEnabled: true,
    });

    // Abort controller ref to cancel stale in-flight requests
    const abortControllerRef = useRef<AbortController | null>(null);
    // Guard ref to prevent overlapping fetches
    const fetchingRef = useRef(false);

    const toggleEnabled = useCallback(() => {
        setState((prev) => ({ ...prev, isEnabled: !prev.isEnabled }))
    }, [])

    const fetchSuggestion = useCallback(async (type: string, editor: any) => {
        // Overlap guard: if a request is already in flight, skip this trigger.
        if (fetchingRef.current) return;

        setState((currentState) => {

            if (!currentState.isEnabled) {
                return currentState
            }

            if (!editor) {
                return currentState
            }

            const model = editor.getModel();
            const cursorPosition = editor.getPosition()

            if (!model || !cursorPosition) {
                return currentState
            }

            const newState = { ...currentState, isLoading: true };

            (async () => {
                // Cancel any previous stale request
                if (abortControllerRef.current) {
                    abortControllerRef.current.abort();
                }
                const controller = new AbortController();
                abortControllerRef.current = controller;
                fetchingRef.current = true;

                try {
                    const fullContent = model.getValue();
                    const lines = fullContent.split("\n");
                    const line = cursorPosition.lineNumber - 1;
                    const column = cursorPosition.column - 1;

                    // Send only surrounding context (40 lines before, 10 after)
                    // instead of the entire file — drastically reduces payload + prompt size.
                    const contextStart = Math.max(0, line - 40);
                    const contextEnd = Math.min(lines.length, line + 10);
                    const contextContent = lines.slice(contextStart, contextEnd).join("\n");

                    const payload = {
                        fileContent: contextContent,
                        cursorLine: line - contextStart,
                        cursorColumn: column,
                        suggestionType: type
                    }

                    const response = await fetch("/api/code-completion", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                        signal: controller.signal
                    })
                    if (!response.ok) {
                        throw new Error(`API responded with status ${response.status}`);
                    }

                    const data = await response.json()

                    if (data.suggestion) {
                        const suggestionText = data.suggestion.trim();
                        setState((prev) => ({
                            ...prev,
                            suggestion: suggestionText,
                            position: {
                                line: cursorPosition.lineNumber,
                                column: cursorPosition.column
                            },
                            isLoading: false
                        }))
                    }
                    else {
                        console.warn("No suggestion received from API.");
                        setState((prev) => ({ ...prev, isLoading: false }));
                    }
                } catch (error: any) {
                    // Ignore aborted requests (stale triggers)
                    if (error?.name === "AbortError") {
                        return;
                    }
                    console.error("Error fetching code suggestion:", error);
                    setState((prev) => ({ ...prev, isLoading: false }));
                } finally {
                    fetchingRef.current = false;
                    if (abortControllerRef.current === controller) {
                        abortControllerRef.current = null;
                    }
                }
            })();

            return newState
        })
    }, [])


    const acceptSuggestion = useCallback((editor: any, monaco: any) => {
        setState((currentState) => {
            if (!currentState.suggestion || !currentState.position || !editor || !monaco) {
                return currentState;
            }

            const { line, column } = currentState.position;
            const sanitizedSuggestion = currentState.suggestion.replace(/^\d+:\s*/gm, "");

            editor.executeEdits("", [
                {
                    range: new monaco.Range(line, column, line, column),
                    text: sanitizedSuggestion,
                    forceMoveMarkers: true,
                }
            ]);

            if (editor && currentState.decoration.length > 0) {
                editor.deltaDecorations(currentState.decoration, [])
            }

            return {
                ...currentState,
                suggestion: null,
                position: null,
                decoration: []
            }
        })
    }, [])

    const rejectSuggestion = useCallback((editor: any) => {
        setState((currentState) => {
            if (editor && currentState.decoration.length > 0) {
                editor.deltaDecorations(currentState.decoration, [])
            }

            return {
                ...currentState,
                suggestion: null,
                position: null,
                decoration: []
            }
        })
    }, []);

    const clearSuggestion = useCallback((editor: any) => {
        setState((currentState) => {
            if (editor && currentState.decoration.length > 0) {
                editor.deltaDecorations(currentState.decoration, []);
            }
            return {
                ...currentState,
                suggestion: null,
                position: null,
                decoration: [],
            };
        });
    }, []);


    return {
        ...state,
        toggleEnabled,
        fetchSuggestion,
        acceptSuggestion,
        rejectSuggestion,
        clearSuggestion
    }

}


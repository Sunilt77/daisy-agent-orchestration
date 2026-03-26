export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5, baseDelayMs = 2000): Promise<T> {
    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt < maxRetries) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            attempt++;
            const errorString = error?.message || String(error);
            const isRetryable = errorString.includes('429') || 
                                errorString.includes('503') || 
                                errorString.includes('UNAVAILABLE') || 
                                errorString.includes('RESOURCE_EXHAUSTED') ||
                                error?.status === 429 || 
                                error?.status === 503;
                                
            if (!isRetryable || attempt >= maxRetries) {
                throw error;
            }
            
            let delay = baseDelayMs * Math.pow(2, attempt - 1);
            
            // Try to parse specific retry delay from Gemini error message
            const retryMatch = errorString.match(/retry in (\d+(\.\d+)?)s/i);
            if (retryMatch && retryMatch[1]) {
                delay = parseFloat(retryMatch[1]) * 1000 + 1000; // Add 1s buffer
            }
            
            console.log(`[Retry] API call failed with retryable error. Attempt ${attempt}/${maxRetries}. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    const errorMessage = lastError?.message || 'Unknown error';
    throw new Error(`Max retries reached (${maxRetries} attempts). Last error: ${errorMessage}`);
}

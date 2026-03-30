import { GoogleGenAI } from '@google/genai';
import { AIGenerationMode, AIModelId } from '../types';

const GEMINI_API_KEY_STORAGE_KEY = 'sprite-boy-gemini-api-key';

function resolveGeminiApiKey(): string {
    if (typeof window === 'undefined') {
        throw new Error('Gemini AI is only available in the browser.');
    }

    const storedKey = window.sessionStorage.getItem(GEMINI_API_KEY_STORAGE_KEY)?.trim();
    if (storedKey) {
        return storedKey;
    }

    const promptedKey = window.prompt(
        'Enter your Gemini API key for this session. It will stay only in sessionStorage and will not be bundled into the app.',
    )?.trim();

    if (!promptedKey) {
        throw new Error('A Gemini API key is required to use AI features in Sprite Boy.');
    }

    window.sessionStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, promptedKey);
    return promptedKey;
}

/**
 * Helper to downscale image if too large (Max 1024px dimension for context)
 */
async function optimizeImageForAI(base64Str: string): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            const MAX_DIM = 1024;
            let w = img.width;
            let h = img.height;

            if (w <= MAX_DIM && h <= MAX_DIM) {
                resolve(base64Str.split(',')[1] || base64Str);
                return;
            }

            const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
            w = Math.floor(w * scale);
            h = Math.floor(h * scale);

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(base64Str.split(',')[1] || base64Str);
                return;
            }
            
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            
            const optimized = canvas.toDataURL('image/png', 0.9);
            resolve(optimized.split(',')[1]);
        };
        img.onerror = () => resolve(base64Str.split(',')[1] || base64Str);
    });
}

/**
 * Generates a sprite based on input images, prompt, model, and mode.
 */
export async function generateSprite(
    contextImages: string[],
    prompt: string,
    model: AIModelId,
    mode: AIGenerationMode
): Promise<string> {
    // Create a new instance right before call as per guidelines
    const genAI = new GoogleGenAI({ apiKey: resolveGeminiApiKey() });

    let systemInstruction =
        'You are a professional pixel artist. You generate high-quality game assets. Output strictly one image part.';
    const finalPrompt = prompt || 'A professional game sprite';

    switch (mode) {
        case 'new_image':
            systemInstruction += " Create a new standalone asset with transparent background.";
            break;
        case 'variation':
            systemInstruction += " Maintain style, color palette and pixel scale of context images. Create a variation.";
            break;
        case 'inbetween':
            systemInstruction += " Create a single intermediate frame for a smooth animation between the provided images.";
            break;
        case 'edit_context':
            systemInstruction += " Apply the requested changes while preserving original pose and style.";
            break;
        case 'full_sheet':
            systemInstruction += " Create a full sprite sheet grid. Use context images as character reference.";
            break;
    }

    try {
        // --- IMAGEN 4 PATH ---
        if (model === 'imagen-4.0-generate-001') {
            const response = await genAI.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: finalPrompt,
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/jpeg',
                    aspectRatio: '1:1',
                },
            });

            const base64Data = response.generatedImages?.[0]?.image?.imageBytes;
            if (!base64Data) {
                throw new Error('Imagen 4 returned no image data.');
            }
            return `data:image/jpeg;base64,${base64Data}`;
        }

        // --- GEMINI IMAGE PATH (Flash/Pro) ---
        else {
            const parts: any[] = [];

            // Context images first
            for (const img of contextImages) {
                const optimizedData = await optimizeImageForAI(img);
                parts.push({
                    inlineData: {
                        mimeType: 'image/png',
                        data: optimizedData,
                    },
                });
            }

            // Prompt last
            parts.push({ text: finalPrompt });

            const response = await genAI.models.generateContent({
                model: model, 
                contents: { parts },
                config: {
                    systemInstruction: systemInstruction,
                    // Use imageConfig if it's gemini-3-pro-image-preview
                    ...(model === 'gemini-3-pro-image-preview'
                        ? {
                              imageConfig: {
                                  aspectRatio: '1:1',
                                  imageSize: '1K',
                              },
                          }
                        : {}),
                },
            });

            const candidates = response.candidates;
            if (!candidates?.[0]?.content?.parts) {
                throw new Error('The model did not return any content parts.');
            }

            // Find the image part in response
            for (const part of candidates[0].content.parts) {
                if (part.inlineData && part.inlineData.data) {
                    return `data:image/png;base64,${part.inlineData.data}`;
                }
            }
            
            throw new Error('No image was generated. Please try a different prompt.');
        }
    } catch (error: any) {
        console.error('AI Generation Error:', error);
        throw new Error(error.message || 'Failed to generate asset.');
    }
}

/**
 * Analyzes a sprite sheet using Gemini.
 */
export async function analyzeImage(base64Image: string): Promise<string> {
    const genAI = new GoogleGenAI({ apiKey: resolveGeminiApiKey() });
    try {
        const optimizedData = await optimizeImageForAI(base64Image);
        const response = await genAI.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: {
                parts: [
                    { inlineData: { mimeType: 'image/png', data: optimizedData } },
                    {
                        text: 'Analyze this sprite sheet as a Technical Game Artist. Provide feedback on consistency, palette, and layout in Markdown.',
                    },
                ],
            },
        });

        return response.text || 'No analysis available.';
    } catch (error: any) {
        return `Analysis failed: ${error.message}`;
    }
}

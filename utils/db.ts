
import { BuilderAsset } from '../types';
import { DEFAULT_ASSETS } from './defaultAssets';

/** An asset record persisted in IndexedDB (blob instead of runtime src). */
export interface StoredAsset extends Omit<BuilderAsset, 'src'> {
    blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

const DB_NAME = 'SpriteSliceDB';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

/** Converts a base64 data URI string to a Blob. */
export function dataURIToBlob(dataURI: string): Blob {
    const splitDataURI = dataURI.split(',');
    const byteString = splitDataURI[0].indexOf('base64') >= 0 ? atob(splitDataURI[1]) : decodeURI(splitDataURI[1]);
    const mimeString = splitDataURI[0].split(':')[1].split(';')[0];

    const ia = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ia], { type: mimeString });
}

function getDB(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => {
                console.error("IndexedDB error:", request.error);
                reject("Error opening database.");
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                const transaction = db.transaction(STORE_NAME, 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const countRequest = store.count();

                countRequest.onsuccess = () => {
                    if (countRequest.result === 0) {
                        const writeTransaction = db.transaction(STORE_NAME, 'readwrite');
                        const writeStore = writeTransaction.objectStore(STORE_NAME);
                        DEFAULT_ASSETS.forEach(asset => {
                            const blob = dataURIToBlob(asset.src);
                            const { src, ...rest } = asset;
                            writeStore.put({ ...rest, blob });
                        });
                        writeTransaction.oncomplete = () => resolve(db);
                        writeTransaction.onerror = () => reject("Error populating default assets.");
                    } else {
                        resolve(db);
                    }
                };
                 countRequest.onerror = () => reject("Error counting assets.");
            };
        });
    }
    return dbPromise;
}

/** Retrieves all stored assets from IndexedDB. */
export async function getAllAssets(): Promise<StoredAsset[]> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject("Error fetching assets.");
    });
}

/** Persists a new asset (with its image blob) to IndexedDB. */
export async function addAsset(asset: Omit<BuilderAsset, 'src' | 'id'>, id: string, blob: Blob): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({ ...asset, id, blob });
        request.onsuccess = () => resolve();
        request.onerror = () => reject("Error adding asset.");
    });
}

/** Deletes an asset from IndexedDB by id. */
export async function deleteAsset(id: string): Promise<void> {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject("Error deleting asset.");
    });
}

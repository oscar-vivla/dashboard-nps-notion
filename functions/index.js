// functions/src/index.js
import { onRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Client } from '@notionhq/client';
import * as dotenv from 'dotenv';

dotenv.config();

// Inicializar Firebase Admin
initializeApp();

// Inicializar Notion Client
const notion = new Client({
    auth: process.env.NOTION_TOKEN
});

// Función auxiliar para convertir Timestamp de Firebase a formato ISO
const formatDate = (timestamp) => {
    if (!timestamp) return null;
    const date = timestamp.toDate();
    return date.toISOString().split('T')[0];
};

// estructura de datos para Notion
const createNotionData = (data) => {
    const properties = {
        'Casa': {
            title: [
                {
                    text: {
                        content: data.hid || 'Sin especificar'
                    }
                }
            ]
        },
        'NPS': {
            number: data.nps || 0
        },
        'Comentario': {
            rich_text: [
                {
                    text: {
                        content: data.comment || ''
                    }
                }
            ]
        },
        'Fecha': {
            date: {
                start: formatDate(data.date) || new Date().toISOString()
            }
        },
        'Propietarios': {
            rich_text: [
                {
                    text: {
                        content: data.uid || ''
                    }
                }
            ]
        }
    };

    // Solo añadir Destino si existe
    if (data.destino) {
        properties['Destino'] = {
            select: {
                name: data.destino
            }
        };
    }

    return {
        parent: {
            database_id: process.env.NOTION_DATABASE_ID,
        },
        properties
    };
};


export const migrateToNotion = onRequest({
    timeoutSeconds: 540,
    memory: '256MiB'
}, async (request, response) => {
    try {
        const db = getFirestore();
        let migratedCount = 0;
        let errorCount = 0;
        const errors = [];

        const snapshot = await db.collection('nps')
            .where('round', '==', 'home')
            .get();

        if (snapshot.empty) {
            return response.json({
                message: 'No hay documentos para migrar',
                migratedCount: 0
            });
        }

        for (const doc of snapshot.docs) {
            try {
                const data = doc.data();
                await notion.pages.create(createNotionData(data));
                migratedCount++;
                console.log(`Migrado documento ${doc.id} correctamente`);
            } catch (docError) {
                errorCount++;
                errors.push({
                    docId: doc.id,
                    error: docError.message
                });
                console.error(`Error migrando documento ${doc.id}:`, docError);
            }
        }

        response.json({
            success: true,
            summary: {
                total: snapshot.size,
                migrated: migratedCount,
                failed: errorCount,
                errors: errors
            }
        });

    } catch (error) {
        console.error('Error en la migración:', error);
        response.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Trigger para nuevos nps
export const syncNewNPSToNotion = onDocumentCreated('nps/{docId}', async (event) => {
    try {
        const snapshot = event.data;
        if (!snapshot) {
            console.log('No data associated with the event');
            return;
        }

        const data = snapshot.data();

        if (data.round !== 'home') {
            console.log('Documento no es de tipo home, ignorando');
            return;
        }

        await notion.pages.create(createNotionData(data));
        console.log(`Creado nuevo registro en Notion para documento ${snapshot.id}`);

    } catch (error) {
        console.error('Error sincronizando con Notion:', error);
        throw error;
    }
});
// packages/database/seed.ts
import { db } from "./src/client";
import { PROVIDERS, getProviderModelIds } from "@ANCIENT/shared";

async function main() {
    console.log("🌱 Seeding model providers...");

    for (const providerData of PROVIDERS) {
        // Upsert the provider
        const provider = await db.modelProvider.upsert({
            where: { id: providerData.id },
            update: {
                label: providerData.label,
                protocol: providerData.protocol,
                defaultBaseUrl: providerData.defaultBaseUrl,
            },
            create: {
                id: providerData.id,
                label: providerData.label,
                protocol: providerData.protocol,
                defaultBaseUrl: providerData.defaultBaseUrl,
                isReseller: false,
            },
        });

        // Clear existing catalog entries for this provider
        await db.modelCatalogEntry.deleteMany({
            where: { providerId: provider.id },
        });

        const modelIds = getProviderModelIds(providerData.id);

        // If no model IDs (e.g., "custom" provider), skip – this means "any" is allowed
        if (modelIds.length === 0) {
            console.log(`  ⏩ Skipping catalog entries for ${providerData.id} (wildcard)`);
            continue;
        }

        // Insert each model into the catalog
        for (const modelId of modelIds) {
            await db.modelCatalogEntry.create({
                data: {
                    providerId: provider.id,
                    modelId,
                    label: modelId, // You could improve labels later
                    contextWindow: 0,
                    isActive: true,
                },
            });
        }

        console.log(`  ✅ ${providerData.id} (${modelIds.length} models)`);
    }

    console.log("✅ Seeding complete.");
    await db.$disconnect();
}

main().catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
});
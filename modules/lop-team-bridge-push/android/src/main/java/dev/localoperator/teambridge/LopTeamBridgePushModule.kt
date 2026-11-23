package dev.localoperator.teambridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The JS surface of the Team Bridge Android presentation
 * (`src/team-bridge/android-presentation.ts`).
 *
 * - `setPresentationStrings`: the localised "me" name and lock-screen
 *   placeholder the decorator draws with while no JS runs (`PresentationStrings`).
 * - `setHubOrigin`: the registered hub origin, the only origin a push
 *   avatar photo may be fetched from (`PushAvatarFetcher`, ADR 0010 S5).
 * - Presentation account admission and retirement mirror accepted registration
 *   and close local shortcuts/notifications before network cleanup.
 *
 * Android only (`expo-module.config.json`); iOS and web resolve no module and
 * the JS side degrades to a no-op.
 */
class LopTeamBridgePushModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)

  override fun definition() = ModuleDefinition {
    Name("LopTeamBridgePush")

    Function("setPresentationStrings") { selfName: String, hiddenPreview: String ->
      PresentationStrings.save(context, selfName, hiddenPreview)
    }

    Function("setHubOrigin") { origin: String ->
      HubOrigin.save(context, origin)
    }

    Function("setPresentationAccount") { accountId: String ->
      BridgePresentationScope.enable(context, accountId)
    }

    Function("retirePresentationAccount") { accountId: String? ->
      BridgePresentationScope.retire(context, accountId)
    }
  }
}

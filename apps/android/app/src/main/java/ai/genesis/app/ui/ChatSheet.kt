package ai.genesis.app.ui

import androidx.compose.runtime.Composable
import ai.genesis.app.MainViewModel
import ai.genesis.app.ui.chat.ChatSheetContent

@Composable
fun ChatSheet(viewModel: MainViewModel) {
  ChatSheetContent(viewModel = viewModel)
}

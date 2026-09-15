package com.saimetric.pos.ui.components

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.widget.Toast
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

data class PosCartProduct(
    val id: String,
    val name: String,
    val price: Double,
    val unit: String = "Each",
    val inStock: Int = 100
)

data class PosCartItemState(
    val product: PosCartProduct,
    val quantity: Int
)

/**
 * Jetpack Compose CartItem for SAIMETRIC POS
 * 
 * FUNCTIONALITY:
 * 1. ON TAP / CLICK: Increase quantity by 1, Toast "Added", animate scale up
 * 2. ON LONG PRESS 500ms: Decrease quantity by 1, Device vibrates, Toast "Removed", animate scale down.
 *    If quantity reaches 0, removes item.
 * 3. ON LONG PRESS 2 SECONDS: Show "Remove Item?" dialog with "Cancel" and "Remove"
 * 
 * UI RULES:
 * - Small toast "Added" on tap, "Removed" on long press
 * - Animate quantity number scaling up on tap, down on long press
 * - Prevent accidental triggers: bounds checking & pointer input cancellation
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun CartItem(
    item: PosCartItemState,
    onQuantityChange: (Int) -> Unit,
    onRemoveItem: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()

    // Quantity state in a MutableState
    var currentQuantity by remember(item.quantity) { mutableIntStateOf(item.quantity) }
    var showRemoveDialog by remember { mutableStateOf(false) }

    // Animation scale target state: 1.0f neutral, 1.35f tap scale-up, 0.75f long-press scale-down
    var scaleTarget by remember { mutableFloatStateOf(1f) }
    val animatedScale by animateFloatAsState(
        targetValue = scaleTarget,
        animationSpec = tween(durationMillis = 200),
        label = "QuantityScaleAnimation",
        finishedListener = {
            // Automatically snap back to 1.0f baseline
            if (scaleTarget != 1f) {
                scaleTarget = 1f
            }
        }
    )

    // Helper: Trigger device vibration safely across Android API levels
    fun triggerVibration(durationMs: Long = 60L) {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }

            vibrator?.let { v ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    v.vibrate(durationMs)
                }
            }
        } catch (_: Exception) {
            // Fallback gracefully on devices without vibrator hardware
        }
    }

    // Helper: Show brief Android toast
    fun showToast(message: String) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }

    // Gesture control handling bounds and durations: 500ms vs 2000ms
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .pointerInput(item.product.id, currentQuantity) {
                detectTapGestures(
                    onPress = { offset ->
                        // Accidental trigger prevention: timer launched on finger press
                        var longPress500Fired = false
                        var longPress2000Fired = false

                        val job500 = coroutineScope.launch {
                            delay(500)
                            longPress500Fired = true
                            triggerVibration(60L)
                            scaleTarget = 0.75f
                            showToast("Removed")

                            val newQty = currentQuantity - 1
                            if (newQty <= 0) {
                                currentQuantity = 0
                                onRemoveItem()
                            } else {
                                currentQuantity = newQty
                                onQuantityChange(newQty)
                            }
                        }

                        val job2000 = coroutineScope.launch {
                            delay(2000)
                            longPress2000Fired = true
                            triggerVibration(120L)
                            showRemoveDialog = true
                        }

                        // Wait for release or cancellation (finger leaving bounds)
                        val released = tryAwaitRelease()
                        job500.cancel()
                        job2000.cancel()

                        // If released cleanly within bounds before 500ms, execute ON TAP
                        if (released && !longPress500Fired && !longPress2000Fired) {
                            val newQty = currentQuantity + 1
                            currentQuantity = newQty
                            scaleTarget = 1.35f
                            showToast("Added")
                            onQuantityChange(newQty)
                        }
                    }
                )
            },
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            // Left details: Product Name and Unit Price
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.product.name,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "$${String.format("%.2f", item.product.price)} / ${item.product.unit}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // Center details: Animated Quantity Display
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(horizontal = 12.dp)
            ) {
                Text(
                    text = "x",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )
                Text(
                    text = "$currentQuantity",
                    modifier = Modifier.scale(animatedScale),
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 20.sp
                    ),
                    color = if (scaleTarget > 1f) Color(0xFF2E7D32)
                    else if (scaleTarget < 1f) Color(0xFFD32F2F)
                    else MaterialTheme.colorScheme.primary
                )
            }

            // Right details: Line Total
            Text(
                text = "$${String.format("%.2f", item.product.price * currentQuantity)}",
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Black),
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }

    // 2-SECOND LONG PRESS CONFIRMATION DIALOG
    if (showRemoveDialog) {
        AlertDialog(
            onDismissRequest = { showRemoveDialog = false },
            icon = {
                Icon(
                    imageVector = Icons.Default.Delete,
                    contentDescription = "Remove Item",
                    tint = MaterialTheme.colorScheme.error
                )
            },
            title = {
                Text(
                    text = "Remove Item?",
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(text = "Are you sure you want to remove \"${item.product.name}\" from the current sale cart?")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showRemoveDialog = false
                        onRemoveItem()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text(text = "Remove", color = Color.White, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                OutlinedButton(
                    onClick = { showRemoveDialog = false }
                ) {
                    Text(text = "Cancel")
                }
            }
        )
    }
}

/**
 * Standard Jetpack Compose CartItem utilizing Modifier.combinedClickable directly.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun CartItemCombinedClickable(
    item: PosCartItemState,
    onQuantityChange: (Int) -> Unit,
    onRemoveItem: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var currentQuantity by remember(item.quantity) { mutableIntStateOf(item.quantity) }
    var showRemoveDialog by remember { mutableStateOf(false) }

    var scaleTarget by remember { mutableFloatStateOf(1f) }
    val animatedScale by animateFloatAsState(
        targetValue = scaleTarget,
        animationSpec = tween(durationMillis = 200),
        label = "CombinedClickableScaleAnimation",
        finishedListener = {
            if (scaleTarget != 1f) scaleTarget = 1f
        }
    )

    fun triggerVibration(durationMs: Long = 60L) {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(durationMs)
            }
        } catch (_: Exception) {}
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .combinedClickable(
                onClick = {
                    // 1. ON TAP / CLICK: Increase quantity by 1
                    val newQty = currentQuantity + 1
                    currentQuantity = newQty
                    scaleTarget = 1.35f
                    Toast.makeText(context, "Added", Toast.LENGTH_SHORT).show()
                    onQuantityChange(newQty)
                },
                onLongClick = {
                    // 2. ON LONG PRESS (500ms default in Compose): Decrease quantity by 1, vibrate
                    triggerVibration(60L)
                    scaleTarget = 0.75f
                    Toast.makeText(context, "Removed", Toast.LENGTH_SHORT).show()

                    val newQty = currentQuantity - 1
                    if (newQty <= 0) {
                        currentQuantity = 0
                        onRemoveItem()
                    } else {
                        currentQuantity = newQty
                        onQuantityChange(newQty)
                    }
                }
            ),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.product.name,
                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "$${String.format("%.2f", item.product.price)} / ${item.product.unit}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.padding(horizontal = 12.dp)
            ) {
                Text(text = "x", color = MaterialTheme.colorScheme.primary)
                Text(
                    text = "$currentQuantity",
                    modifier = Modifier.scale(animatedScale),
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 20.sp
                    ),
                    color = if (scaleTarget > 1f) Color(0xFF2E7D32)
                    else if (scaleTarget < 1f) Color(0xFFD32F2F)
                    else MaterialTheme.colorScheme.primary
                )
            }

            Text(
                text = "$${String.format("%.2f", item.product.price * currentQuantity)}",
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Black),
                color = MaterialTheme.colorScheme.onSurface
            )
        }
    }

    if (showRemoveDialog) {
        AlertDialog(
            onDismissRequest = { showRemoveDialog = false },
            icon = {
                Icon(
                    imageVector = Icons.Default.Delete,
                    contentDescription = "Remove Item",
                    tint = MaterialTheme.colorScheme.error
                )
            },
            title = { Text(text = "Remove Item?", fontWeight = FontWeight.Bold) },
            text = { Text(text = "Are you sure you want to remove \"${item.product.name}\" from the current sale cart?") },
            confirmButton = {
                Button(
                    onClick = {
                        showRemoveDialog = false
                        onRemoveItem()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
                ) {
                    Text(text = "Remove", color = Color.White, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                OutlinedButton(onClick = { showRemoveDialog = false }) {
                    Text(text = "Cancel")
                }
            }
        )
    }
}

import { Text, TextInput, type TextInputProps, View } from "react-native";

import { CONTROL, ROLE, state } from "@/ui/a11y";
import { useTokenColor } from "@/ui/appearance";
import { type FieldState, fieldClasses } from "@/ui/variants";

/**
 * A single-line text field.
 *
 * Three constraints from docs/design/components.md § 4 and § 0.1 that the
 * component enforces rather than documents:
 *
 *   - **`body` = 16pt, always.** Below 16 the OS zooms the page on focus, which
 *     moves the layout under the reader's thumb. The type step is not a prop.
 *   - **The border is `border-control`**, because on a plain ground it is the
 *     field's only boundary — a structural rule, not decoration.
 *   - **A placeholder is never the only label.** `label` is required and rendered
 *     as the accessible name; the placeholder is a hint, and the type reflects
 *     that by not allowing a placeholder-only field.
 */
export type InputProps = {
	/** The field's accessible name. Required: a placeholder cannot be one. */
	label: string;
	value: string;
	onChangeText: (value: string) => void;
	placeholder?: string;
	/** `invalid` adds `border-danger`; the adjacent message is the caller's, in
	 * `body-sm`, because colour alone never carries failure. */
	invalid?: boolean;
	disabled?: boolean;
	secureTextEntry?: boolean;
	/** URLs, hosts and ids are typed without the keyboard's automatic
	 *  capitalisation — a capitalised hostname is a different string. */
	autoCapitalize?: TextInputProps["autoCapitalize"];
	autoFocus?: boolean;
	onSubmitEditing?: () => void;
	returnKeyType?: TextInputProps["returnKeyType"];
	/** Optional: the control's own identifier is the fallback, so a screen
	 *  that does not name a control is still addressable. */
	testID?: string;
};

export const Input = ({
	label,
	value,
	onChangeText,
	placeholder,
	invalid = false,
	disabled = false,
	secureTextEntry,
	autoFocus,
	autoCapitalize,
	onSubmitEditing,
	returnKeyType,
	testID = CONTROL.input,
}: InputProps) => {
	const fieldState: FieldState = disabled
		? "disabled"
		: invalid
			? "invalid"
			: "rest";
	// A placeholder is `ink-muted`, and React Native takes it as a colour VALUE
	// rather than a class, so it comes from the token the same way an icon colour
	// does — there is no class name to hang it on.
	const placeholderColour = useTokenColor("ink-muted");
	return (
		<View className="gap-1.5">
			{/* Visible label as well as the accessible name: a reader who can see the
			 * field needs to know what it wants without reading the placeholder,
			 * which disappears the moment they type. */}
			<Text className="text-body-sm text-ink-muted">{label}</Text>
			<TextInput
				className={fieldClasses(fieldState)}
				accessibilityRole={ROLE.text}
				accessibilityLabel={label}
				accessibilityState={state({ disabled })}
				value={value}
				onChangeText={onChangeText}
				placeholder={placeholder}
				placeholderTextColor={placeholderColour}
				editable={!disabled}
				secureTextEntry={secureTextEntry}
				autoFocus={autoFocus}
				autoCapitalize={autoCapitalize}
				onSubmitEditing={onSubmitEditing}
				returnKeyType={returnKeyType}
				testID={testID}
			/>
		</View>
	);
};

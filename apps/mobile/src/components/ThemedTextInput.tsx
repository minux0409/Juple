import type { ComponentProps } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { colors } from '../theme/tokens';

/**
 * The one TextInput of the app. Typed text is styled by each field's own `color`; what the platform would otherwise decide - the
 * placeholder (a near-black native default that disappears on a dark card), the caret and the selection handles - comes from the theme
 * roles, so no field can forget them. A field that wants another placeholder colour still passes `placeholderTextColor`.
 */
export function ThemedTextInput({ ref, placeholderTextColor, selectionColor, cursorColor, ...rest }: TextInputProps & { readonly ref?: ComponentProps<typeof TextInput>['ref'] }) {
  return (
    <TextInput
      cursorColor={cursorColor ?? colors.brand}
      placeholderTextColor={placeholderTextColor ?? colors.placeholder}
      ref={ref}
      selectionColor={selectionColor ?? colors.brand}
      {...rest}
    />
  );
}

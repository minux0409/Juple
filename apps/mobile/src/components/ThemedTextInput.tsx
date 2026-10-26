import { useCallback, useEffect, useRef, type ComponentProps, type Ref } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { colors } from '../theme/tokens';
import { useKeyboardToolbar, type TextInputHandle } from './keyboardToolbar';

function assignRef<T>(target: Ref<T> | undefined, value: T | null) {
  if (typeof target === 'function') {
    target(value);
  } else if (target) {
    target.current = value;
  }
}

/**
 * The one TextInput of the app. Typed text is styled by each field's own `color`; what the platform would otherwise decide - the
 * placeholder (a near-black native default that disappears on a dark card), the caret and the selection handles - comes from the theme
 * roles, so no field can forget them. A field that wants another placeholder colour still passes `placeholderTextColor`.
 *
 * On iOS every field also gets the keyboard toolbar ([↑] [↓] ... [완료], see keyboardToolbar) - unless it brings an
 * inputAccessoryViewID of its own.
 */
export function ThemedTextInput({
  ref,
  placeholderTextColor,
  selectionColor,
  cursorColor,
  inputAccessoryViewID,
  onFocus,
  ...rest
}: TextInputProps & { readonly ref?: ComponentProps<typeof TextInput>['ref'] }) {
  const inputRef = useRef<TextInputHandle | null>(null);
  const editableRef = useRef(rest.editable !== false);
  editableRef.current = rest.editable !== false;
  const isEditable = useCallback(() => editableRef.current, []);
  const toolbar = useKeyboardToolbar(inputRef, isEditable, inputAccessoryViewID === undefined);
  const { register } = toolbar;
  useEffect(register, [register]);

  const setRef = useCallback(
    (node: TextInputHandle | null) => {
      inputRef.current = node;
      assignRef(ref as Ref<TextInputHandle> | undefined, node);
    },
    [ref],
  );

  return (
    <>
      <TextInput
        cursorColor={cursorColor ?? colors.brand}
        inputAccessoryViewID={inputAccessoryViewID ?? toolbar.nativeID}
        onFocus={event => {
          toolbar.onFieldFocus();
          onFocus?.(event);
        }}
        placeholderTextColor={placeholderTextColor ?? colors.placeholder}
        ref={setRef}
        selectionColor={selectionColor ?? colors.brand}
        {...rest}
      />
      {toolbar.element}
    </>
  );
}

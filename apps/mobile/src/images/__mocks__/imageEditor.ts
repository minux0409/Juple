/** Jest stand-in for @react-native-community/image-editor: records each crop and answers a new file, like the native one. */
const cropImage = jest.fn(async (_uri: string, data: { size: { width: number }; displaySize?: { width: number } }) => ({
  uri: 'file:///cache/cropped.jpg',
  path: '/cache/cropped.jpg',
  name: 'cropped.jpg',
  size: 1,
  width: data.displaySize?.width ?? data.size.width,
  height: data.displaySize?.width ?? data.size.width,
  type: 'image/jpeg',
}));

export default { cropImage };

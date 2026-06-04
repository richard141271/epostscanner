type FileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
};

type FileSystemFileEntry = FileSystemEntry & {
  file: (successCallback: (file: File) => void, errorCallback?: (err: unknown) => void) => void;
};

type FileSystemDirectoryEntry = FileSystemEntry & {
  createReader: () => FileSystemDirectoryReader;
};

type FileSystemDirectoryReader = {
  readEntries: (
    successCallback: (entries: FileSystemEntry[]) => void,
    errorCallback?: (err: unknown) => void,
  ) => void;
};

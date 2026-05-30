package setup

import (
	"os"
)

const initializedFile = ".initialized"

func Needed() bool {
	_, err := os.Stat(initializedFile)
	return os.IsNotExist(err)
}

func MarkDone() {
	os.WriteFile(initializedFile, []byte{}, 0644)
}

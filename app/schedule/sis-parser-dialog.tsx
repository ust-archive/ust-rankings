import React, {type HTMLAttributes} from 'react';
import {SisParser, SisUrl} from '@/data/schedule/sis-parser';
import {findClass} from '@/data/schedule';
import {
  Dialog, DialogClose,
  DialogContent,
  DialogDescription, DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Import} from 'lucide-react';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';

type SisParserDialogProps = {
  callback: (classNumbers: number[]) => void;
} & HTMLAttributes<HTMLDivElement>;

export function SisParserDialog({callback, ...props}: SisParserDialogProps) {
  const [text, setText] = React.useState('');
  const classNumbers = SisParser.parse(text);
  const classes = classNumbers.map(it => findClass(it));

  function openSis() {
    window.open(SisUrl, 'sis', 'popup=true');
  }

  function handleSubmit() {
    callback(classNumbers);
  }

  return <Dialog {...props}>
    <DialogTrigger asChild>
      <Button variant='outline' className='w-1/2'>
        <Import className='mr-2 h-4 w-4'/> Import from SIS
      </Button>
    </DialogTrigger>
    <DialogContent className='sm:max-w-[425px]'>
      <DialogHeader>
        <DialogTitle>Import from SIS</DialogTitle>
        <DialogDescription>
          <ol className='mt-2 space-y-1'>
            <li>Go to <a onClick={openSis}>SIS</a>.</li>
            <li>Press <kbd>Ctrl/⌘</kbd> + <kbd>A</kbd> to select all text on the page.</li>
            <li>Press <kbd>Ctrl/⌘</kbd> + <kbd>C</kbd> to copy the text.</li>
            <li>Press <kbd>Ctrl/⌘</kbd> + <kbd>V</kbd> to paste the text here.</li>
          </ol>
        </DialogDescription>
      </DialogHeader>
      <Textarea
        className='w-full'
        placeholder='Paste Here'
        defaultValue={text}
        content={text}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setText(e.target.value);
        }}
      />
      <div className='space-y-2'>
        <Label>Class Numbers</Label>
        {
          classes.length === 0 ? <p className='text-sm text-gray-500 dark:text-gray-400'>No classes found.</p>
            : <ul className='text-sm font-mono text-gray-500 dark:text-gray-400'>
              {classes.map(([course, sections]) =>
                <li key={sections[0].number}>
                  {course.program} {course.code} {sections[0].section} ({sections[0].number})
                </li>,
              )}
            </ul>
        }
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type='submit' onClick={handleSubmit}>Submit! </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
